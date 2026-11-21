# Prueba de punta a punta de la cotización (Fase 1).
# Requiere la API corriendo (pnpm dev:api o node apps/api/dist/main.js) con la base migrada y sembrada.
# Uso: .\cotizar.ps1 [-Servicio TAXI|REMIS]
param(
  [ValidateSet('TAXI', 'REMIS')] [string] $Servicio = 'TAXI',
  [string] $Api = 'http://localhost:3000'
)

# San Bernardo (Av. Chiozza) → Mar de Ajó (centro)
$body = @{
  origin      = @{ lat = -36.6875; lng = -56.680 }
  destination = @{ lat = -36.716;  lng = -56.680 }
  serviceType = $Servicio
} | ConvertTo-Json -Compress

$q = Invoke-RestMethod -Method Post -Uri "$Api/api/v1/fares/quote" -ContentType 'application/json' -Body $body

"TOTAL: $($q.totalFormatted)  alcance=$($q.scope)  temporada=$($q.tariff.season)  franja=$($q.tariff.timeBand)"
"Fuera del origen: $($q.corridor.outsideOriginMeters) m ($($q.corridor.measurement)), sentido $($q.corridor.direction)"
"Viaje de Vuelta: elegible=$($q.backhaul.eligible), vuelve $($q.backhaul.returnDirection)"
$q.lines | ForEach-Object { '  {0,-26} {1,10}  {2}' -f $_.code, $_.amountCents, $_.detail }
if ($q.warnings.Count -gt 0) { 'Advertencias:'; $q.warnings | ForEach-Object { "  - $($_.code): $($_.message)" } }

$suma = ($q.lines | Measure-Object -Property amountCents -Sum).Sum
if ($suma -ne $q.totalCents) { throw "La suma de las líneas ($suma) no coincide con el total ($($q.totalCents))" }
'OK · la suma de las líneas coincide con el total'
