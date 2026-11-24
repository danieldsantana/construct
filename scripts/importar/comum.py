"""Utilidades compartilhadas pelos importadores (conexão, caminhos, normalização).

Os importadores leem os arquivos-fonte da pasta local "Dados criação/" (fora do git) e gravam
no banco usando SUPABASE_DB_URL do .env. São idempotentes: rodar de novo atualiza, não duplica.
"""
from __future__ import annotations

import re
import sys
import unicodedata
import warnings
from decimal import Decimal, InvalidOperation
from pathlib import Path

import psycopg2

warnings.filterwarnings("ignore")  # avisos de estilos/validação do openpyxl

RAIZ = Path(__file__).resolve().parents[2]
DADOS = RAIZ / "Dados criação"


def ler_env() -> dict[str, str]:
    texto = (RAIZ / ".env").read_text(encoding="utf-8")
    return dict(re.findall(r"^\s*([A-Z_]+)\s*=\s*(.*?)\s*$", texto, re.M))


def conectar():
    url = ler_env().get("SUPABASE_DB_URL", "")
    if not url or "SUA_SENHA" in url:
        sys.exit("SUPABASE_DB_URL não está preenchida no .env")
    return psycopg2.connect(url, connect_timeout=20)


def sem_acento(s) -> str:
    """'Data de Emissão:' -> 'DATA DE EMISSAO:' (maiúsculas, sem acento, espaços normalizados)."""
    s = "".join(c for c in unicodedata.normalize("NFD", str(s)) if unicodedata.category(c) != "Mn")
    return " ".join(s.upper().split())


def numero(valor) -> Decimal | None:
    """Converte '7,5', '# 7,5', 7.5, '-' e vazios para Decimal (ou None)."""
    if valor is None:
        return None
    if isinstance(valor, (int, float)):
        return Decimal(str(valor))
    s = str(valor).replace("#", "").replace(",", ".").strip()
    if s in ("", "-", "–"):
        return None
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


TORRE_RE = re.compile(r"^\d+/\d+[A-Z]?$")


def numero_torre(valor) -> str | None:
    """'8/2' -> '8/2'; pórtico, notas e vazios -> None."""
    if valor is None:
        return None
    s = str(valor).strip().upper()
    return s if TORRE_RE.match(s) else None


OF_ISA_RE = re.compile(r"BRM-(\d+)")
OF_CURTA_RE = re.compile(r"^\s*OF\s*-\s*(\d+)\b")


def numero_of(texto) -> int | None:
    """Número da OF: 'OF-71607-EM-BRM-114' -> 114 · 'OF-114' / 'OF - 114' -> 114 · 'OFT', 'SAC …' -> None."""
    if not texto:
        return None
    t = str(texto)
    m = OF_ISA_RE.search(t) or OF_CURTA_RE.match(t)
    return int(m.group(1)) if m else None
