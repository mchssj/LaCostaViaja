# OSRM (ruteo vial) para el corredor de La Costa

El API funciona sin OSRM (`ROUTING_PROVIDER=straight-line`, marcado como ruteo degradado). Para ruteo real:

```powershell
# 1. Descargar el extracto OSM de Argentina (Geofabrik) en infra/osrm/data/ y recortarlo al partido (osmium):
#    osmium extract -b -56.95,-37.10,-56.55,-36.25 argentina-latest.osm.pbf -o la-costa.osm.pbf
# 2. Preprocesar (perfil auto, algoritmo MLD):
docker run --rm -v "${PWD}/infra/osrm/data:/data" ghcr.io/project-osrm/osrm-backend:v5.27.1 osrm-extract -p /opt/car.lua /data/la-costa.osm.pbf
docker run --rm -v "${PWD}/infra/osrm/data:/data" ghcr.io/project-osrm/osrm-backend:v5.27.1 osrm-partition /data/la-costa.osrm
docker run --rm -v "${PWD}/infra/osrm/data:/data" ghcr.io/project-osrm/osrm-backend:v5.27.1 osrm-customize /data/la-costa.osrm
# 3. Levantar y apuntar el API:
docker compose --profile routing up -d osrm
# .env → ROUTING_PROVIDER=osrm  OSRM_BASE_URL=http://localhost:5000
```

Con OSRM, la porción interurbana se mide sobre la **geometría real de la ruta** (`ROUTE_GEOMETRY`);
sin OSRM se proyecta sobre el eje RP11 (`CORRIDOR_PROJECTION`).
