#!/usr/bin/env bash
set -euo pipefail

# Despliegue de una versión a producción.
#
#   ./scripts/desplegar.sh
#
# Construye para linux/arm64 (la instancia es Graviton), publica en ECR, apunta
# el parámetro de SSM a la versión nueva y le pide a la instancia que la tome.
# Las migraciones corren dentro de la VPC, antes de levantar la API.

cd "$(dirname "$0")/.."
TF=infra/terraform

REGION=$(terraform -chdir="$TF" output -raw region 2>/dev/null || echo us-east-1)
REPO=$(terraform -chdir="$TF" output -raw repositorio_ecr)
INSTANCIA=$(terraform -chdir="$TF" output -raw id_instancia)
PREFIJO=$(terraform -chdir="$TF" output -raw prefijo_parametros)

# La etiqueta es el commit. Inmutable en ECR: una etiqueta siempre es el mismo build.
SHA=$(git rev-parse --short HEAD)
SUCIO=$(git status --porcelain | wc -l | tr -d ' ')
[ "$SUCIO" != "0" ] && SHA="$SHA-sucio-$(date +%H%M%S)"
IMAGEN="$REPO:$SHA"

echo "▸ Construyendo $IMAGEN (linux/arm64)"
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "${REPO%%/*}"
docker buildx build --platform linux/arm64 -t "$IMAGEN" --push .

echo "▸ Publicando la versión en SSM"
aws ssm put-parameter --name "$PREFIJO/IMAGEN_API" --type String \
  --value "$IMAGEN" --overwrite --region "$REGION" >/dev/null

echo "▸ Desplegando en $INSTANCIA"
ID=$(aws ssm send-command \
  --document-name AWS-RunShellScript \
  --targets "Key=instanceids,Values=$INSTANCIA" \
  --parameters 'commands=["/opt/cci/desplegar.sh"]' \
  --region "$REGION" --query Command.CommandId --output text)

for _ in $(seq 1 60); do
  sleep 5
  ESTADO=$(aws ssm get-command-invocation --command-id "$ID" --instance-id "$INSTANCIA" \
    --region "$REGION" --query Status --output text 2>/dev/null || echo Pending)
  case "$ESTADO" in
    Success) break ;;
    Failed|Cancelled|TimedOut)
      aws ssm get-command-invocation --command-id "$ID" --instance-id "$INSTANCIA" \
        --region "$REGION" --query StandardErrorContent --output text
      echo "✗ Despliegue fallido ($ESTADO)"; exit 1 ;;
  esac
done

# Se verifica por CloudFront, no contra el origen: el puerto 3000 lo filtran
# muchas redes corporativas y un 403 del filtro no dice nada del despliegue.
URL=$(terraform -chdir="$TF" output -raw endpoint_api)
echo "▸ Verificando $URL"
curl -fsS --retry 10 --retry-delay 3 "$URL/salud" && echo
echo "✓ $IMAGEN en producción"
