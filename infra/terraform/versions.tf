terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # El estado NO vive en el disco de nadie. Descomentar tras crear el bucket
  # (ver infra/terraform/README.md) y ejecutar `terraform init -migrate-state`.
  # backend "s3" {
  #   bucket       = "cci-tfstate-<sufijo>"
  #   key          = "captura-inventarios/terraform.tfstate"
  #   region       = "us-east-1"
  #   encrypt      = true
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Proyecto    = "captura-inventarios"
      Entorno     = var.entorno
      Gestionado  = "terraform"
      Repositorio = "hackathon-colsubsidio-hoteleria"
    }
  }
}
