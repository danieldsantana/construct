# ui.py — Componentes visuais compartilhados — CONSTRUCT
import streamlit as st

# Paleta e estilo global do CONSTRUCT
CSS_GLOBAL = """
<style>
    @import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&family=Barlow+Condensed:wght@700;800&display=swap');

    html, body, [class*="css"] {
        font-family: 'Barlow', sans-serif;
    }

    /* Sidebar */
    section[data-testid="stSidebar"] {
        background-color: #0d1b2a;
    }
    section[data-testid="stSidebar"] * {
        color: #c9d6df !important;
    }
    section[data-testid="stSidebar"] .stSelectbox label,
    section[data-testid="stSidebar"] .stTextInput label {
        color: #8a9bb0 !important;
    }

    /* Botão primário */
    div.stButton > button[kind="primary"] {
        background-color: #1a6fbd;
        color: white;
        border: none;
        border-radius: 4px;
        font-family: 'Barlow', sans-serif;
        font-weight: 600;
        letter-spacing: 0.5px;
    }
    div.stButton > button[kind="primary"]:hover {
        background-color: #155fa0;
    }

    /* Botão secundário */
    div.stButton > button[kind="secondary"] {
        border-radius: 4px;
        font-family: 'Barlow', sans-serif;
    }

    /* Cabeçalho das páginas */
    h1 {
        font-family: 'Barlow Condensed', sans-serif !important;
        font-weight: 800 !important;
        letter-spacing: 1px !important;
        color: #0d1b2a !important;
    }

    /* Métricas */
    div[data-testid="metric-container"] {
        background-color: #f0f4f8;
        border-left: 4px solid #1a6fbd;
        padding: 12px 16px;
        border-radius: 4px;
    }

    /* Rodapé */
    .construct-footer {
        position: fixed;
        bottom: 10px;
        right: 16px;
        font-size: 0.68rem;
        color: #bbb;
        letter-spacing: 0.3px;
        pointer-events: none;
        z-index: 999;
        font-family: 'Barlow', sans-serif;
    }
</style>
"""

_CSS_FOOTER = """
<div class="construct-footer">Desenvolvido por Daniel Dias de Santana</div>
"""

def aplicar_estilo():
    st.markdown(CSS_GLOBAL, unsafe_allow_html=True)

def rodape():
    st.markdown(CSS_GLOBAL + _CSS_FOOTER, unsafe_allow_html=True)
