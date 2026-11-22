import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OPERATOR_ROLES, PERMISSIONS, ROLE_LABELS, ROLE_PERMISSIONS, MFA_REQUIRED_ROLES } from '@lacosta/domain';
import { Allow, CurrentPrincipal, OPERATORS, ReqMeta, RequirePermission, type Principal, type RequestMeta } from '../../security/principal';
import { CreateUserDto, ReasonDto, UpdateUserDto } from './admin.dto';
import { UsersService } from './users.service';

@ApiTags('admin · usuarios')
@ApiBearerAuth()
@Allow(...OPERATORS)
@Controller({ path: 'admin', version: ['1', VERSION_NEUTRAL] })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /** Matriz de roles y permisos (solo lectura): cualquier operador puede ver qué hace cada rol. */
  @Get('roles')
  roles() {
    return {
      permissions: PERMISSIONS,
      roles: OPERATOR_ROLES.map((r) => ({ role: r, ...ROLE_LABELS[r], permissions: ROLE_PERMISSIONS[r], mfaRequired: MFA_REQUIRED_ROLES.includes(r) })),
    };
  }

  @RequirePermission('users.manage')
  @Get('users')
  list() {
    return this.users.list();
  }

  @RequirePermission('users.manage')
  @Get('users/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(id);
  }

  @RequirePermission('users.manage')
  @Post('users')
  create(@CurrentPrincipal() p: Principal, @Body() body: CreateUserDto, @ReqMeta() meta: RequestMeta) {
    return this.users.create(p, body, meta);
  }

  @RequirePermission('users.manage')
  @Patch('users/:id')
  update(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateUserDto, @ReqMeta() meta: RequestMeta) {
    return this.users.update(p, id, body, meta);
  }

  @RequirePermission('users.manage')
  @Post('users/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() body: ReasonDto, @ReqMeta() meta: RequestMeta) {
    return this.users.setActive(p, id, false, body.reason, meta);
  }

  @RequirePermission('users.manage')
  @Post('users/:id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.users.setActive(p, id, true, undefined, meta);
  }

  @RequirePermission('users.manage')
  @Post('users/:id/unlock')
  @HttpCode(HttpStatus.OK)
  unlock(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.users.unlock(p, id, meta);
  }

  @RequirePermission('users.manage')
  @Post('users/:id/reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.users.resetPassword(p, id, meta);
  }

  @RequirePermission('users.manage')
  @Post('users/:id/reset-mfa')
  @HttpCode(HttpStatus.OK)
  resetMfa(@CurrentPrincipal() p: Principal, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.users.resetMfa(p, id, meta);
  }
}
