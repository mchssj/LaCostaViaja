import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError, hasPermission, InvalidInputError, NotFoundError } from '@lacosta/domain';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { AuditService, diff } from '../../security/audit.service';
import { hashSecret } from '../../security/crypto';
import { temporaryPin } from '../../security/password-policy';
import type { Principal, RequestMeta } from '../../security/principal';
import { DriverPresenceService } from '../presence/driver-presence.service';
import { FILE_STORAGE, sniffFileType, type IFileStorage } from './file-storage';

export type EntityType = 'DRIVER' | 'VEHICLE' | 'AGENCY';
export type DocumentType = 'DNI' | 'LICENCIA_PROFESIONAL' | 'VTV' | 'SEGURO_PASAJEROS' | 'HABILITACION_MUNICIPAL' | 'ANTECEDENTES_PENALES' | 'CUIT' | 'OTRO';
type PermitStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';

/**
 * Documentos obligatorios para HABILITAR cada tipo de entidad. Valores de desarrollo: la lista
 * definitiva la fija el municipio (ver PENDIENTES.md).
 */
export const REQUIRED_DOCUMENTS: Readonly<Record<EntityType, readonly DocumentType[]>> = {
  DRIVER: ['DNI', 'LICENCIA_PROFESIONAL', 'HABILITACION_MUNICIPAL', 'ANTECEDENTES_PENALES'],
  VEHICLE: ['VTV', 'SEGURO_PASAJEROS', 'HABILITACION_MUNICIPAL'],
  AGENCY: ['CUIT', 'HABILITACION_MUNICIPAL'],
};

const TABLE: Record<EntityType, 'drivers' | 'vehicles' | 'agencies'> = { DRIVER: 'drivers', VEHICLE: 'vehicles', AGENCY: 'agencies' };
const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Transiciones permitidas del estado de habilitación. */
const TRANSITIONS: Record<PermitStatus, readonly PermitStatus[]> = {
  PENDING: ['ACTIVE', 'REVOKED'],
  ACTIVE: ['SUSPENDED', 'REVOKED'],
  SUSPENDED: ['ACTIVE', 'REVOKED'],
  REVOKED: [],
};

const STATUS_LABEL: Record<PermitStatus, string> = { PENDING: 'pendiente', ACTIVE: 'habilitado', SUSPENDED: 'suspendido', REVOKED: 'revocado' };

export interface DriverInput {
  agencyId?: string | null;
  baseLocalityCode: string;
  dni: string;
  cuil: string;
  firstName: string;
  lastName: string;
  phone: string;
  professionalLicenseNumber: string;
  professionalLicenseClass: 'D1' | 'D2' | 'D3' | 'D4';
  professionalLicenseExpiresOn: string;
  municipalDriverPermitNumber: string;
  municipalDriverPermitExpiresOn: string;
  criminalRecordExpiresOn?: string | null;
  acceptsInterurban?: boolean;
}

export interface VehicleInput {
  agencyId?: string | null;
  serviceType: 'TAXI' | 'REMIS';
  plate: string;
  make: string;
  model: string;
  modelYear: number;
  color: string;
  passengerSeats: number;
  wheelchairAccessible?: boolean;
  ownerName: string;
  ownerCuit: string;
  municipalVehiclePermitNumber: string;
  municipalVehiclePermitExpiresOn: string;
  vtvExpiresOn: string;
  insurerName: string;
  insurancePolicyNumber: string;
  passengerInsuranceExpiresOn: string;
}

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

/**
 * Habilitaciones (Fase 5): alta/edición de choferes y vehículos, autorizaciones chofer↔vehículo,
 * documentos con verificación, cambios de estado con requisitos, reseteo de PIN y vencimientos.
 * El operador de agencia solo trabaja sobre SU agencia y solo edita lo que está pendiente.
 */
@Injectable()
export class HabilitationsService {
  private readonly logger = new Logger(HabilitationsService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(FILE_STORAGE) private readonly storage: IFileStorage,
    private readonly audit: AuditService,
    private readonly presence: DriverPresenceService,
  ) {}

  // ------------------------------------------------------------------ choferes
  async createDriver(actor: Principal, input: DriverInput, meta: RequestMeta) {
    const agencyId = this.scopedAgency(actor, input.agencyId ?? null);
    const id = await this.tx(async (c) => {
      const locality = await this.localityId(c, input.baseLocalityCode);
      const { rows } = await c
        .query<{ id: string }>(
          `INSERT INTO drivers (agency_id, base_locality_id, dni, cuil, first_name, last_name, phone, professional_license_number,
                                professional_license_class, professional_license_expires_on, municipal_driver_permit_number,
                                municipal_driver_permit_expires_on, criminal_record_expires_on, accepts_interurban, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'PENDING') RETURNING id`,
          [agencyId, locality, digits(input.dni), digits(input.cuil), input.firstName.trim(), input.lastName.trim(), input.phone.trim(),
           input.professionalLicenseNumber.trim(), input.professionalLicenseClass, input.professionalLicenseExpiresOn,
           input.municipalDriverPermitNumber.trim(), input.municipalDriverPermitExpiresOn, input.criminalRecordExpiresOn ?? null, input.acceptsInterurban ?? true],
        )
        .catch(friendly);
      await this.audit.record({ actor, action: 'CREATE', entityType: 'driver', entityId: rows[0]!.id, changes: { ...input, dni: '[reservado]', cuil: '[reservado]' }, meta }, c);
      return rows[0]!.id;
    });
    return { id };
  }

  async updateDriver(actor: Principal, id: string, input: Partial<DriverInput>, meta: RequestMeta) {
    await this.tx(async (c) => {
      const before = await this.lockEntity(c, 'DRIVER', id, actor);
      const locality = input.baseLocalityCode ? await this.localityId(c, input.baseLocalityCode) : null;
      const agencyId = input.agencyId !== undefined ? this.scopedAgency(actor, input.agencyId) : undefined;
      await c
        .query(
          `UPDATE drivers SET
             agency_id = CASE WHEN $2 THEN $3::uuid ELSE agency_id END,
             base_locality_id = COALESCE($4, base_locality_id),
             dni = COALESCE($5, dni), cuil = COALESCE($6, cuil), first_name = COALESCE($7, first_name), last_name = COALESCE($8, last_name),
             phone = COALESCE($9, phone), professional_license_number = COALESCE($10, professional_license_number),
             professional_license_class = COALESCE($11, professional_license_class),
             professional_license_expires_on = COALESCE($12::date, professional_license_expires_on),
             municipal_driver_permit_number = COALESCE($13, municipal_driver_permit_number),
             municipal_driver_permit_expires_on = COALESCE($14::date, municipal_driver_permit_expires_on),
             criminal_record_expires_on = CASE WHEN $15 THEN $16::date ELSE criminal_record_expires_on END,
             accepts_interurban = COALESCE($17, accepts_interurban)
           WHERE id = $1`,
          [id, agencyId !== undefined, agencyId ?? null, locality, input.dni ? digits(input.dni) : null, input.cuil ? digits(input.cuil) : null,
           input.firstName?.trim() ?? null, input.lastName?.trim() ?? null, input.phone?.trim() ?? null, input.professionalLicenseNumber?.trim() ?? null,
           input.professionalLicenseClass ?? null, input.professionalLicenseExpiresOn ?? null, input.municipalDriverPermitNumber?.trim() ?? null,
           input.municipalDriverPermitExpiresOn ?? null, input.criminalRecordExpiresOn !== undefined, input.criminalRecordExpiresOn ?? null, input.acceptsInterurban ?? null],
        )
        .catch(friendly);
      const after = await this.lockEntity(c, 'DRIVER', id, actor);
      await this.audit.record({ actor, action: 'UPDATE', entityType: 'driver', entityId: id, changes: maskDiff(diff(before, after)), meta }, c);
    });
    return { id };
  }

  // ------------------------------------------------------------------ vehículos
  async createVehicle(actor: Principal, input: VehicleInput, meta: RequestMeta) {
    const agencyId = this.scopedAgency(actor, input.agencyId ?? null);
    const id = await this.tx(async (c) => {
      const { rows } = await c
        .query<{ id: string }>(
          `INSERT INTO vehicles (agency_id, service_type, plate, make, model, model_year, color, passenger_seats, wheelchair_accessible,
                                 owner_name, owner_cuit, municipal_vehicle_permit_number, municipal_vehicle_permit_expires_on, vtv_expires_on,
                                 insurer_name, insurance_policy_number, passenger_insurance_expires_on, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'PENDING') RETURNING id`,
          [agencyId, input.serviceType, normalizePlate(input.plate), input.make.trim(), input.model.trim(), input.modelYear, input.color.trim(),
           input.passengerSeats, input.wheelchairAccessible ?? false, input.ownerName.trim(), digits(input.ownerCuit),
           input.municipalVehiclePermitNumber.trim(), input.municipalVehiclePermitExpiresOn, input.vtvExpiresOn, input.insurerName.trim(),
           input.insurancePolicyNumber.trim(), input.passengerInsuranceExpiresOn],
        )
        .catch(friendly);
      await this.audit.record({ actor, action: 'CREATE', entityType: 'vehicle', entityId: rows[0]!.id, changes: { ...input, ownerCuit: '[reservado]' }, meta }, c);
      return rows[0]!.id;
    });
    return { id };
  }

  async updateVehicle(actor: Principal, id: string, input: Partial<VehicleInput>, meta: RequestMeta) {
    await this.tx(async (c) => {
      const before = await this.lockEntity(c, 'VEHICLE', id, actor);
      const agencyId = input.agencyId !== undefined ? this.scopedAgency(actor, input.agencyId) : undefined;
      await c
        .query(
          `UPDATE vehicles SET
             agency_id = CASE WHEN $2 THEN $3::uuid ELSE agency_id END,
             service_type = COALESCE($4::service_type, service_type), plate = COALESCE($5, plate), make = COALESCE($6, make), model = COALESCE($7, model),
             model_year = COALESCE($8, model_year), color = COALESCE($9, color), passenger_seats = COALESCE($10, passenger_seats),
             wheelchair_accessible = COALESCE($11, wheelchair_accessible), owner_name = COALESCE($12, owner_name), owner_cuit = COALESCE($13, owner_cuit),
             municipal_vehicle_permit_number = COALESCE($14, municipal_vehicle_permit_number),
             municipal_vehicle_permit_expires_on = COALESCE($15::date, municipal_vehicle_permit_expires_on),
             vtv_expires_on = COALESCE($16::date, vtv_expires_on), insurer_name = COALESCE($17, insurer_name),
             insurance_policy_number = COALESCE($18, insurance_policy_number),
             passenger_insurance_expires_on = COALESCE($19::date, passenger_insurance_expires_on)
           WHERE id = $1`,
          [id, agencyId !== undefined, agencyId ?? null, input.serviceType ?? null, input.plate ? normalizePlate(input.plate) : null, input.make?.trim() ?? null,
           input.model?.trim() ?? null, input.modelYear ?? null, input.color?.trim() ?? null, input.passengerSeats ?? null, input.wheelchairAccessible ?? null,
           input.ownerName?.trim() ?? null, input.ownerCuit ? digits(input.ownerCuit) : null, input.municipalVehiclePermitNumber?.trim() ?? null,
           input.municipalVehiclePermitExpiresOn ?? null, input.vtvExpiresOn ?? null, input.insurerName?.trim() ?? null,
           input.insurancePolicyNumber?.trim() ?? null, input.passengerInsuranceExpiresOn ?? null],
        )
        .catch(friendly);
      const after = await this.lockEntity(c, 'VEHICLE', id, actor);
      await this.audit.record({ actor, action: 'UPDATE', entityType: 'vehicle', entityId: id, changes: maskDiff(diff(before, after)), meta }, c);
    });
    return { id };
  }

  // ------------------------------------------------------------------ autorización chofer ↔ vehículo
  async createAuthorization(
    actor: Principal,
    input: { driverId: string; vehicleId: string; role: 'OWNER_DRIVER' | 'PRIMARY_DRIVER' | 'RELIEF_DRIVER'; authorizationNumber: string; validFrom: string; validTo?: string | null },
    meta: RequestMeta,
  ) {
    const id = await this.tx(async (c) => {
      await this.lockEntity(c, 'DRIVER', input.driverId, actor, false);
      await this.lockEntity(c, 'VEHICLE', input.vehicleId, actor, false);
      const { rows } = await c
        .query<{ id: string }>(
          `INSERT INTO driver_vehicle_compliance (driver_id, vehicle_id, role, authorization_number, validity, status)
           VALUES ($1, $2, $3, $4, daterange($5::date, $6::date, '[)'), 'PENDING') RETURNING id`,
          [input.driverId, input.vehicleId, input.role, input.authorizationNumber.trim(), input.validFrom, input.validTo ?? null],
        )
        .catch(friendly);
      await this.audit.record({ actor, action: 'CREATE', entityType: 'driver_vehicle_compliance', entityId: rows[0]!.id, changes: input, meta }, c);
      return rows[0]!.id;
    });
    return { id };
  }

  async setAuthorizationStatus(actor: Principal, id: string, status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED', reason: string | undefined, meta: RequestMeta) {
    await this.tx(async (c) => {
      const { rows } = await c.query<{ status: PermitStatus }>(`SELECT status FROM driver_vehicle_compliance WHERE id = $1 FOR UPDATE`, [id]);
      if (!rows[0]) throw new NotFoundError('Autorización inexistente', { id });
      if (!TRANSITIONS[rows[0].status].includes(status)) throw new DomainError('INVALID_TRANSITION', `No se puede pasar de ${STATUS_LABEL[rows[0].status]} a ${STATUS_LABEL[status]}`);
      if (status !== 'ACTIVE' && !reason) throw new InvalidInputError('Indicá el motivo', {});
      const { rows: u } = await c.query<{ username: string }>(`SELECT username FROM operator_users WHERE id = $1`, [actor.id]);
      await c.query(
        `UPDATE driver_vehicle_compliance SET status = $2::permit_status, verified_by = CASE WHEN $2::text = 'ACTIVE' THEN $3::text ELSE verified_by END,
                verified_at = CASE WHEN $2::text = 'ACTIVE' THEN now() ELSE verified_at END, notes = COALESCE($4::text, notes) WHERE id = $1`,
        [id, status, u[0]?.username ?? actor.id, reason ?? null],
      );
      await this.audit.record({ actor, action: auditAction(status), entityType: 'driver_vehicle_compliance', entityId: id, changes: { status: { before: rows[0].status, after: status }, reason }, meta }, c);
    });
    return { id };
  }

  // ------------------------------------------------------------------ estado de habilitación
  async setStatus(actor: Principal, type: EntityType, id: string, input: { status: PermitStatus; reason?: string; until?: string | null }, meta: RequestMeta) {
    const result = await this.tx(async (c) => {
      const { rows } = await c.query<{ status: PermitStatus }>(`SELECT status FROM ${TABLE[type]} WHERE id = $1 FOR UPDATE`, [id]);
      if (!rows[0]) throw new NotFoundError('Registro inexistente', { id });
      const from = rows[0].status;
      if (!TRANSITIONS[from].includes(input.status)) throw new DomainError('INVALID_TRANSITION', `No se puede pasar de ${STATUS_LABEL[from]} a ${STATUS_LABEL[input.status]}`);
      if (input.status !== 'ACTIVE' && (!input.reason || input.reason.trim().length < 3)) throw new InvalidInputError('Indicá el motivo', { field: 'reason' });
      if (input.status === 'ACTIVE') {
        const missing = await this.missingDocuments(c, type, id);
        if (missing.length) {
          throw new DomainError('INVALID_TRANSITION', `No se puede habilitar: faltan documentos verificados y vigentes (${missing.join(', ')})`, { missingDocuments: missing });
        }
      }
      if (type === 'DRIVER') {
        await c.query(
          `UPDATE drivers SET status = $2::permit_status,
                  suspension_reason = CASE WHEN $2::text = 'SUSPENDED' THEN $3::text WHEN $2::text = 'ACTIVE' THEN NULL ELSE suspension_reason END,
                  suspended_until = CASE WHEN $2::text = 'SUSPENDED' THEN $4::date ELSE NULL END,
                  verified_by = CASE WHEN $2::text = 'ACTIVE' THEN $5::uuid ELSE verified_by END,
                  verified_at = CASE WHEN $2::text = 'ACTIVE' THEN now() ELSE verified_at END
           WHERE id = $1`,
          [id, input.status, input.reason?.trim() ?? null, input.until ?? null, actor.id],
        );
      } else {
        await c.query(
          `UPDATE ${TABLE[type]} SET status = $2::permit_status, verified_by = CASE WHEN $2::text = 'ACTIVE' THEN $3::uuid ELSE verified_by END,
                  verified_at = CASE WHEN $2::text = 'ACTIVE' THEN now() ELSE verified_at END WHERE id = $1`,
          [id, input.status, actor.id],
        );
      }
      await this.audit.record(
        { actor, action: auditAction(input.status), entityType: TABLE[type].slice(0, -1).replace(/ie$/, 'y'), entityId: id, changes: { status: { before: from, after: input.status }, reason: input.reason, until: input.until }, meta },
        c,
      );
      return { from, to: input.status };
    });
    // Un chofer suspendido o revocado sale del despacho ya (si está en un viaje, lo termina; no recibe más ofertas).
    if (type === 'DRIVER' && result.to !== 'ACTIVE') {
      await this.presence.endShift(id).catch((err: Error) => this.logger.warn(`No se cerró el turno de ${id}: ${err.message}`));
    }
    return result;
  }

  async resetDriverPin(actor: Principal, id: string, meta: RequestMeta) {
    const pin = temporaryPin();
    await this.tx(async (c) => {
      await this.lockEntity(c, 'DRIVER', id, actor, false);
      await c.query(`UPDATE drivers SET pin_hash = $2, pin_failed_attempts = 0, pin_locked_until = NULL WHERE id = $1`, [id, await hashSecret(pin)]);
      await this.audit.record({ actor, action: 'PASSWORD_RESET', entityType: 'driver', entityId: id, changes: { pin: 'reset' }, meta }, c);
    });
    return { temporaryPin: pin };
  }

  // ------------------------------------------------------------------ documentos
  async listDocuments(actor: Principal, filter: { entityType?: EntityType; entityId?: string; status?: string }) {
    const { rows } = await this.pool.query(
      `SELECT d.id, d.entity_type, d.entity_id, d.document_type, d.file_name, d.mime_type, d.file_size_bytes, d.status, d.rejected_reason,
              to_char(d.expires_on, 'YYYY-MM-DD') AS expires_on, d.uploaded_at, up.username AS uploaded_by_username,
              d.verified_at AS reviewed_at, rv.username AS reviewed_by_username, d.superseded_by, d.notes,
              CASE d.entity_type
                WHEN 'DRIVER' THEN (SELECT dr.last_name || ', ' || dr.first_name FROM drivers dr WHERE dr.id = d.entity_id)
                WHEN 'VEHICLE' THEN (SELECT v.plate FROM vehicles v WHERE v.id = d.entity_id)
                ELSE (SELECT a.trade_name FROM agencies a WHERE a.id = d.entity_id) END AS entity_label
       FROM habilitation_documents d
       LEFT JOIN operator_users up ON up.id = d.uploaded_by
       LEFT JOIN operator_users rv ON rv.id = d.verified_by
       WHERE ($1::habilitation_entity_type IS NULL OR d.entity_type = $1)
         AND ($2::uuid IS NULL OR d.entity_id = $2)
         AND ($3::document_review_status IS NULL OR d.status = $3)
         AND ($4::uuid IS NULL OR ${AGENCY_OWNS_DOCUMENT})
       ORDER BY d.superseded_by IS NOT NULL, d.uploaded_at DESC
       LIMIT 500`,
      [filter.entityType ?? null, filter.entityId ?? null, filter.status ?? null, actor.role === 'AGENCY_OPERATOR' ? (actor.agencyId ?? ZERO_UUID) : null],
    );
    return rows;
  }

  async uploadDocument(
    actor: Principal,
    input: { entityType: EntityType; entityId: string; documentType: DocumentType; expiresOn?: string | null; notes?: string },
    file: UploadedFile | undefined,
    meta: RequestMeta,
  ) {
    if (!file?.buffer?.length) throw new InvalidInputError('Adjuntá el archivo', { field: 'file' });
    if (file.size > MAX_FILE_BYTES) throw new InvalidInputError('El archivo supera los 10 MB', { field: 'file' });
    const kind = sniffFileType(file.buffer);
    if (!kind) throw new InvalidInputError('Formato no permitido: subí un PDF, JPG o PNG', { field: 'file' });
    const stored = await this.storage.put(file.buffer, kind.ext);
    const id = await this.tx(async (c) => {
      await this.lockEntity(c, input.entityType, input.entityId, actor, false);
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO habilitation_documents (entity_type, entity_id, document_type, file_name, file_hash, mime_type, file_size_bytes, uploaded_by,
                                             storage_key, expires_on, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [input.entityType, input.entityId, input.documentType, safeFileName(file.originalname, kind.ext), stored.sha256, kind.mime, file.size, actor.id,
         stored.key, input.expiresOn ?? null, input.notes?.trim() || null],
      );
      const newId = rows[0]!.id;
      // El documento anterior del mismo tipo queda como historial.
      await c.query(
        `UPDATE habilitation_documents SET superseded_by = $1
         WHERE entity_type = $2 AND entity_id = $3 AND document_type = $4 AND id <> $1 AND superseded_by IS NULL`,
        [newId, input.entityType, input.entityId, input.documentType],
      );
      await this.audit.record({ actor, action: 'CREATE', entityType: 'habilitation_document', entityId: newId, changes: { ...input, sha256: stored.sha256, size: file.size }, meta }, c);
      return newId;
    });
    return { id };
  }

  async readDocument(actor: Principal, id: string): Promise<{ data: Buffer; mime: string; fileName: string }> {
    const { rows } = await this.pool.query<{ storage_key: string | null; mime_type: string; file_name: string; file_hash: string; entity_type: EntityType; entity_id: string }>(
      `SELECT storage_key, mime_type, file_name, file_hash, entity_type, entity_id FROM habilitation_documents d
       WHERE id = $1 AND ($2::uuid IS NULL OR ${AGENCY_OWNS_DOCUMENT.replaceAll('$4', '$2')})`,
      [id, actor.role === 'AGENCY_OPERATOR' ? (actor.agencyId ?? ZERO_UUID) : null],
    );
    const d = rows[0];
    if (!d?.storage_key) throw new NotFoundError('Documento inexistente o sin archivo', { id });
    return { data: await this.storage.get(d.storage_key), mime: d.mime_type, fileName: d.file_name };
  }

  async reviewDocument(actor: Principal, id: string, decision: { verified: boolean; reason?: string; expiresOn?: string | null }, meta: RequestMeta) {
    await this.tx(async (c) => {
      const { rows } = await c.query<{ status: string; superseded_by: string | null; uploaded_by: string | null }>(
        `SELECT status, superseded_by, uploaded_by FROM habilitation_documents WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const d = rows[0];
      if (!d) throw new NotFoundError('Documento inexistente', { id });
      if (d.status !== 'PENDING') throw new DomainError('INVALID_TRANSITION', 'El documento ya fue revisado');
      if (d.superseded_by) throw new DomainError('INVALID_TRANSITION', 'Hay una versión más nueva de este documento: revisá esa');
      if (!decision.verified && (!decision.reason || decision.reason.trim().length < 3)) throw new InvalidInputError('Indicá el motivo del rechazo', { field: 'reason' });
      await c.query(
        `UPDATE habilitation_documents SET status = $2::document_review_status, verified_by = $3, verified_at = now(), rejected_reason = $4::text,
                expires_on = COALESCE($5::date, expires_on) WHERE id = $1`,
        [id, decision.verified ? 'VERIFIED' : 'REJECTED', actor.id, decision.verified ? null : decision.reason!.trim(), decision.expiresOn ?? null],
      );
      await this.audit.record({ actor, action: decision.verified ? 'VERIFY' : 'REJECT', entityType: 'habilitation_document', entityId: id, changes: decision, meta }, c);
    });
    return { id };
  }

  // ------------------------------------------------------------------ vencimientos y requisitos
  async expirations(actor: Principal, days: number) {
    const { rows } = await this.pool.query(
      `WITH items AS (
         SELECT 'DRIVER' AS entity_type, d.id AS entity_id, d.last_name || ', ' || d.first_name AS label, d.agency_id, 'Licencia profesional' AS item, d.professional_license_expires_on AS expires_on FROM drivers d WHERE d.status <> 'REVOKED'
         UNION ALL SELECT 'DRIVER', d.id, d.last_name || ', ' || d.first_name, d.agency_id, 'Habilitación municipal de conductor', d.municipal_driver_permit_expires_on FROM drivers d WHERE d.status <> 'REVOKED'
         UNION ALL SELECT 'DRIVER', d.id, d.last_name || ', ' || d.first_name, d.agency_id, 'Certificado de antecedentes', d.criminal_record_expires_on FROM drivers d WHERE d.status <> 'REVOKED' AND d.criminal_record_expires_on IS NOT NULL
         UNION ALL SELECT 'VEHICLE', v.id, v.plate, v.agency_id, 'VTV', v.vtv_expires_on FROM vehicles v WHERE v.status <> 'REVOKED'
         UNION ALL SELECT 'VEHICLE', v.id, v.plate, v.agency_id, 'Seguro de pasajeros', v.passenger_insurance_expires_on FROM vehicles v WHERE v.status <> 'REVOKED'
         UNION ALL SELECT 'VEHICLE', v.id, v.plate, v.agency_id, 'Habilitación municipal del vehículo', v.municipal_vehicle_permit_expires_on FROM vehicles v WHERE v.status <> 'REVOKED'
         UNION ALL SELECT 'AGENCY', a.id, a.trade_name, a.id, 'Habilitación de la agencia', a.permit_expires_on FROM agencies a WHERE a.status <> 'REVOKED'
       )
       SELECT entity_type, entity_id, label, item, to_char(expires_on, 'YYYY-MM-DD') AS expires_on, (expires_on - ar_today()) AS days_left
       FROM items
       WHERE expires_on <= ar_today() + $1::int AND ($2::uuid IS NULL OR agency_id = $2)
       ORDER BY expires_on, label`,
      [days, actor.role === 'AGENCY_OPERATOR' ? (actor.agencyId ?? ZERO_UUID) : null],
    );
    return rows;
  }

  async requirements(type: EntityType, id: string) {
    const client = await this.pool.connect();
    try {
      const missing = await this.missingDocuments(client, type, id);
      return { required: REQUIRED_DOCUMENTS[type], missing, ready: missing.length === 0 };
    } finally {
      client.release();
    }
  }

  private async missingDocuments(c: PoolClient, type: EntityType, id: string): Promise<DocumentType[]> {
    const { rows } = await c.query<{ document_type: DocumentType }>(
      `SELECT DISTINCT document_type FROM habilitation_documents
       WHERE entity_type = $1 AND entity_id = $2 AND superseded_by IS NULL AND status = 'VERIFIED'
         AND (expires_on IS NULL OR expires_on >= ar_today())`,
      [type, id],
    );
    const ok = new Set(rows.map((r) => r.document_type));
    return REQUIRED_DOCUMENTS[type].filter((d) => !ok.has(d));
  }

  // ------------------------------------------------------------------ alcance y apoyo
  /** El operador de agencia siempre trabaja con SU agencia, aunque mande otra. */
  private scopedAgency(actor: Principal, requested: string | null): string | null {
    if (actor.role === 'AGENCY_OPERATOR') return actor.agencyId ?? null;
    return requested;
  }

  /**
   * Bloquea la fila y verifica el alcance. La agencia solo toca registros propios y, si `pendingOnly`,
   * solo los pendientes: lo habilitado lo modifica Habilitaciones (para no saltear la verificación).
   */
  private async lockEntity(c: PoolClient, type: EntityType, id: string, actor: Principal, pendingOnly = true): Promise<Record<string, unknown>> {
    const agencyCol = type === 'AGENCY' ? 'id' : 'agency_id';
    const { rows } = await c.query<Record<string, unknown>>(`SELECT * FROM ${TABLE[type]} WHERE id = $1 FOR UPDATE`, [id]);
    const row = rows[0];
    const isAgency = actor.role === 'AGENCY_OPERATOR';
    if (!row || (isAgency && row[agencyCol] !== actor.agencyId)) throw new NotFoundError('Registro inexistente', { id });
    if (isAgency && pendingOnly && row['status'] !== 'PENDING') {
      throw new DomainError('FORBIDDEN', 'Este registro ya está habilitado: los cambios los hace la Dirección de Transporte');
    }
    if (!hasPermission(actor.role, 'fleet.view')) throw new DomainError('FORBIDDEN', 'Sin permiso');
    const { pin_hash: _p, ...safe } = row;
    return safe;
  }

  private async localityId(c: PoolClient, code: string): Promise<string> {
    const { rows } = await c.query<{ id: string }>(`SELECT id FROM localities WHERE code = $1`, [code]);
    if (!rows[0]) throw new InvalidInputError('Localidad inexistente', { field: 'baseLocalityCode' });
    return rows[0].id;
  }

  private async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

/** SQL: el documento pertenece a la agencia $4 (directo o a través del chofer / vehículo). */
const AGENCY_OWNS_DOCUMENT = `(
  (d.entity_type = 'AGENCY' AND d.entity_id = $4)
  OR (d.entity_type = 'DRIVER' AND EXISTS (SELECT 1 FROM drivers x WHERE x.id = d.entity_id AND x.agency_id = $4))
  OR (d.entity_type = 'VEHICLE' AND EXISTS (SELECT 1 FROM vehicles x WHERE x.id = d.entity_id AND x.agency_id = $4)))`;

function auditAction(status: string): 'APPROVE' | 'SUSPEND' | 'REVOKE' {
  return status === 'ACTIVE' ? 'APPROVE' : status === 'SUSPENDED' ? 'SUSPEND' : 'REVOKE';
}

const digits = (s: string) => s.replace(/\D/g, '');
const normalizePlate = (s: string) => s.replace(/[\s-]/g, '').toUpperCase();

function safeFileName(name: string, ext: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[^\w\-. áéíóúñÁÉÍÓÚÑ]/g, '_').slice(0, 80) || 'documento';
  return `${base}.${ext}`;
}

/** En la auditoría no se guardan DNI/CUIL completos. */
function maskDiff(d: Record<string, { before: unknown; after: unknown }>) {
  for (const k of ['dni', 'cuil', 'owner_cuit']) if (d[k]) d[k] = { before: '[reservado]', after: '[reservado]' };
  delete d['updated_at'];
  return d;
}

/** Errores de la base → mensajes para quien carga el formulario. */
function friendly(err: { code?: string; constraint?: string; message?: string }): never {
  const c = err.constraint ?? '';
  if (err.code === '23505') {
    const what = c.includes('dni') ? 'DNI' : c.includes('cuil') ? 'CUIL' : c.includes('plate') ? 'patente' : c.includes('permit') ? 'número de habilitación' : c.includes('authorization') ? 'número de autorización' : 'dato';
    throw new InvalidInputError(`Ya existe un registro con ese ${what}`, { constraint: c });
  }
  if (err.code === '23514') {
    const msg: Record<string, string> = {
      drivers_cuil_matches_dni: 'El CUIL no corresponde al DNI',
      drivers_cuil_check: 'CUIL inválido',
      drivers_phone_check: 'Teléfono inválido: formato +54 9 2257 123456 (sin espacios)',
      vehicles_plate_check: 'Patente inválida (AB123CD o ABC123)',
      vehicles_owner_cuit_check: 'CUIT del titular inválido',
      vehicles_remis_requires_agency: 'Un remis tiene que pertenecer a una agencia',
      vehicles_model_year_check: 'Año del modelo inválido',
      vehicles_passenger_seats_check: 'Plazas: entre 1 y 8',
    };
    throw new InvalidInputError(msg[c] ?? `Dato inválido (${c || err.message})`, { constraint: c });
  }
  if (err.code === '23P01') throw new InvalidInputError('Ya hay una autorización vigente para ese chofer y vehículo en esas fechas', { constraint: c });
  if (err.code === '22007' || err.code === '22008') throw new InvalidInputError('Fecha inválida (AAAA-MM-DD)', {});
  throw err;
}
