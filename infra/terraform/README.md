# Infraestructura

Todo lo que vive en AWS se crea con Terraform. **Nada se toca a mano en la consola** —
un recurso creado a mano no aparece en el estado, no se puede reproducir y desaparece
en el siguiente `apply` de otra persona.

## Qué levanta

| Recurso | MVP | Producción |
|---|---|---|
| VPC, 2 subredes públicas + 2 privadas | ✅ | ✅ |
| EC2 `t4g.small` con Docker Compose | ✅ 1 instancia + IP elástica | reemplazada por el ASG |
| ALB + Auto Scaling Group | ❌ escrito, no construido | ✅ |
| RDS PostgreSQL 17 | ✅ `db.t4g.micro` | Multi-AZ, 30 días de respaldo |
| ElastiCache Redis 7 | ✅ 1 nodo | 2 nodos con failover |
| S3 de evidencia + ciclo de vida | ✅ | ✅ |
| ECR | ✅ | ✅ |
| SSM Parameter Store | ✅ | ✅ |

**Sin NAT Gateway a propósito.** Ni RDS ni Redis necesitan salida a internet, y un
NAT cuesta más que la instancia del backend.

## Requisitos previos

```bash
# 1 · Bucket para el estado (una sola vez, por cuenta)
aws s3api create-bucket --bucket cci-tfstate-<sufijo> --region us-east-1
aws s3api put-bucket-versioning --bucket cci-tfstate-<sufijo> \
  --versioning-configuration Status=Enabled

# 2 · Descomentar el bloque `backend "s3"` en versions.tf con ese nombre
```

## Uso

```bash
terraform init
terraform plan  -var-file=entornos/mvp.tfvars
terraform apply -var-file=entornos/mvp.tfvars
```

Después del `apply`, cargar las credenciales de proveedores. **No pasan por
Terraform** para que no queden en el archivo de estado:

```bash
aws ssm put-parameter --name /cci/mvp/DEEPGRAM_API_KEY  --type SecureString --value '...' --overwrite
aws ssm put-parameter --name /cci/mvp/OPENROUTER_API_KEY --type SecureString --value '...' --overwrite
```

Ninguna es obligatoria: sin ellas el sistema arranca en **modo simulado**, sin costo
y sin red externa (Restricción 5).

## Acceso a la instancia

```bash
aws ssm start-session --target $(terraform output -raw id_instancia)
```

Sin SSH y sin puerto 22 abierto. Además de ser más seguro, evita el problema de
tener que volver a autorizar la IP cada vez que el ISP la rota.

## Desplegar una versión

La instancia es **Graviton (ARM)**. La imagen debe construirse para `linux/arm64`
o no arranca:

```bash
REPO=$(terraform output -raw repositorio_ecr)
aws ecr get-login-password | docker login --username AWS --password-stdin "${REPO%%/*}"
docker buildx build --platform linux/arm64 -t "$REPO:$(git rev-parse --short HEAD)" --push .
```

## Encender el escalado

```bash
terraform apply -var-file=entornos/mvp.tfvars -var 'habilitar_escalado=true'
```

Es un cambio de variable, no de arquitectura, porque la API es stateless: sesión en
cookie firmada (D-20), caché compartida en Redis (D-18) y el audio va del navegador
directo a Deepgram (D-07-A). No hay sticky sessions ni draining que gestionar.

**La métrica de escalado es `SesionesActivas` por instancia, no peticiones por
segundo.** Cada operario escribe una vez cada ~15 s: escalar por peticiones mediría
lo que no duele. Y como el pico es predecible —el inventario es mensual y se
agenda— hay pre-calentamiento programado además del seguimiento de objetivo.

## Usuario de IAM para desplegar

La política está en [`iam-despliegue.json`](./iam-despliegue.json).

```bash
aws iam create-user --user-name cci-terraform
aws iam put-user-policy --user-name cci-terraform \
  --policy-name cci-terraform --policy-document file://iam-despliegue.json
aws iam create-access-key --user-name cci-terraform
```

⚠️ **Esta política puede crear roles de IAM** (los necesita para el perfil de la
instancia), y eso es una vía de escalada de privilegios: quien la tenga puede
crear un rol con más permisos de los que él mismo tiene y pasárselo a una
instancia. Está acotada con tres cosas:

1. Los roles solo pueden llamarse `cci-*`.
2. Un `Deny` explícito sobre crear usuarios, llaves de acceso y políticas de usuario.
3. Casi todo va condicionado a `us-east-1`.

Si la cuenta es de Colsubsidio y no tuya, lo correcto no es un usuario con llaves
sino **un rol asumible con OIDC desde GitHub Actions** — sin credenciales de larga
vida en ningún lado. Se cambia sin tocar el resto de la configuración.

## Lo que este directorio NO despliega

**El frontend.** Lo construye y despliega otro integrante del equipo, en su propio
repositorio y con su propio pipeline. La frontera entre los dos es el contrato
OpenAPI (`specs/001-captura-inventarios/contracts/openapi.yaml`), no un despliegue
compartido — que es justamente lo que exige el Principio II.
