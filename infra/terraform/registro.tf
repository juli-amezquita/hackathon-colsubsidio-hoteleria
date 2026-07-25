# Registro de imágenes. La instancia es Graviton (ARM), así que las imágenes
# se construyen para linux/arm64:
#   docker buildx build --platform linux/arm64 -t <repo>:<sha> --push .
resource "aws_ecr_repository" "api" {
  name                 = "${local.nombre}-api"
  image_tag_mutability = "IMMUTABLE" # una etiqueta siempre apunta al mismo build

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = { Name = "${local.nombre}-api" }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Conservar las ultimas 15 imagenes"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 15
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_iam_role_policy" "ecr_lectura" {
  name = "${local.nombre}-ecr"
  role = aws_iam_role.backend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchCheckLayerAvailability",
        ]
        Resource = aws_ecr_repository.api.arn
      },
    ]
  })
}
