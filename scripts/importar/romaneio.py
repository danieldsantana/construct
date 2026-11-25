"""Leitura do PDF digital da NF Brametal: DANFE (nº, OF, remessa, volumes, peso) e ROMANEIO (uma linha por UD).

Usado por nfs_pdf.py e lancar_nf.py. Só texto (PyMuPDF); PDF só imagem não é lido.
Romaneio, por linha (uma célula por linha no texto): seq · remessa · UD · SKU · lote · tipo UD (FD/CM) · OV ·
item OV (às vezes na mesma linha da descrição) · descrição PA · descrição SKU (pode quebrar) · qtd · peso unit · peso total.
PDF de lote traz o romaneio do lote inteiro: filtrar pela REMESSA do DANFE da própria NF.
"""
from __future__ import annotations

import re
from pathlib import Path

import fitz  # PyMuPDF

LINHA = re.compile(
    r"\n(\d+)\n(\d{8,10})\n(\d{10})\n(\d{6,})\n([^\n]*)\n(FD|CM|[A-Z]{2})\n(\d+)\n(\d+)[ \n](.+?)"
    r"\n(\d+(?:\.\d{3})*(?:,\d+)?)\n(\d+(?:\.\d{3})*(?:,\d+)?)\n(\d+(?:\.\d{3})*(?:,\d+)?)(?=\n)", re.S)
VOLUMES = re.compile(r"\n(\d+)\n([A-Z]+)\n([\d.]+,\d+)\n([\d.]+,\d+)\nCFOP")
PESO_PROTHEUS = re.compile(r"PESO L[IÍ]QUIDO\n([\d.]+,\d+)\n")


def br(s: str) -> float:
    return float(s.replace(".", "").replace(",", "."))


def ler_pdf(caminho: Path) -> dict:
    d = fitz.open(caminho)
    paginas = [d[i].get_text() for i in range(len(d))]
    d.close()
    danfe = "".join(paginas[:2])
    if len(danfe.strip()) < 50:
        return {"erro": "PDF só imagem"}
    # DANFE SAP: "SÉRIE\n257057\n" · "OC:OF-… Número Contrato" · "REMESSA: 0080060146"
    # DANFE Protheus (até ~nov/2025): "N. 000229602\nSÉRIE 1" · "OF-71607-EM-BRM-18 ROMANEIO: 045473"
    nf = re.search(r"S[ÉE]RIE\n(\d+)\n", danfe) or re.search(r"N\. (\d+)\nS[ÉE]RIE", danfe)
    oc = re.search(r"OC:\s*(.*?)\s+N[úu]mero Contrato", danfe) or re.search(r"(OF-[^\n]*?)\s+ROMANEIO:", danfe)
    rem = re.search(r"REMESSA:\s*(\d+)", danfe) or re.search(r"ROMANEIO:\s*(\d+)", danfe)
    vol = VOLUMES.search(danfe)
    liq = PESO_PROTHEUS.search(danfe) if not vol else None  # DANFE Protheus: "PESO LIQUIDO\n4,986"
    itens = []
    for pg, t in enumerate(paginas):
        if "ROMANEIO" not in t[:200]:
            continue
        for m in LINHA.finditer("\n" + t):
            itens.append({"pagina": pg + 1, "seq": int(m.group(1)), "remessa": m.group(2).lstrip("0"), "ud": m.group(3),
                          "sku": m.group(4), "lote": m.group(5).strip() or None, "tipo_ud": m.group(6), "ov": m.group(7),
                          "item_ov": m.group(8), "descricao": " ".join(m.group(9).split()),
                          "quantidade": br(m.group(10)), "peso_unit": br(m.group(11)), "peso_total": br(m.group(12))})
    remessa = rem.group(1).lstrip("0") if rem else None
    if remessa and any(i["remessa"] == remessa for i in itens):
        itens = [i for i in itens if i["remessa"] == remessa]
    return {"nf": nf.group(1).lstrip("0") if nf else None, "oc": " ".join(oc.group(1).split()) if oc else None,
            "remessa": remessa, "volumes": int(vol.group(1)) if vol else None, "especie": vol.group(2) if vol else None,
            "peso_bruto": br(vol.group(3)) if vol else None,
            "peso_liquido": br(vol.group(4)) if vol else (br(liq.group(1)) if liq else None),
            "romaneio": itens}


def romaneio_confere(x: dict) -> list[str]:
    """Problemas que impedem usar o romaneio (vazio = confere): soma do peso = peso líquido do DANFE, sequência completa."""
    probs = []
    it = x.get("romaneio") or []
    if not it:
        return ["romaneio não lido"]
    seq = sorted(i["seq"] for i in it)
    if seq != list(range(1, len(seq) + 1)):
        probs.append(f"sequência do romaneio com buracos ({len(seq)} linhas, última {seq[-1]})")
    soma = sum(i["peso_total"] for i in it)
    if x.get("peso_liquido") is None:
        probs.append("peso do DANFE não lido")
    elif abs(soma - x["peso_liquido"]) > 0.05:
        probs.append(f"soma do romaneio {soma:.3f} kg × DANFE {x['peso_liquido']:.3f} kg")
    return probs
