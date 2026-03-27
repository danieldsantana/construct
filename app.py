# app.py — Tela de login CONSTRUCT
import streamlit as st
from db.auth import fazer_login, fazer_logout, usuario_logado

st.set_page_config(page_title="CONSTRUCT", page_icon="🏗️", layout="centered")

st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;500;600&display=swap');

    html, body, [class*="css"] {
        font-family: 'Barlow', sans-serif;
        background-color: #f5f7fa;
    }

    .login-wrapper {
        max-width: 400px;
        margin: 48px auto 0 auto;
        text-align: center;
    }

    .construct-logo {
        font-family: 'Barlow Condensed', sans-serif;
        font-size: 3.6rem;
        font-weight: 800;
        letter-spacing: 6px;
        color: #0d1b2a;
        margin-bottom: 0;
        line-height: 1;
    }

    .construct-tagline {
        font-size: 0.75rem;
        font-weight: 600;
        color: #1a6fbd;
        letter-spacing: 4px;
        text-transform: uppercase;
        margin-top: 4px;
        margin-bottom: 8px;
    }

    .construct-obra {
        font-size: 0.78rem;
        color: #8a9bb0;
        letter-spacing: 1px;
        margin-bottom: 32px;
    }

    .dev-credit {
        position: fixed;
        bottom: 18px;
        width: 100%;
        text-align: center;
        font-size: 0.70rem;
        color: #bbb;
        letter-spacing: 0.4px;
    }

    /* Esconde o menu e rodapé padrão do Streamlit na tela de login */
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
</style>
""", unsafe_allow_html=True)

HEADER = """
<div class="login-wrapper">
    <p class="construct-logo">🏗️ CONSTRUCT</p>
    <p class="construct-tagline">Controle de Recebimento de Materiais</p>
    <p class="construct-obra">Elecnor Brasil · LTs 500 kV · ISA CTEEP</p>
</div>
"""

if usuario_logado():
    perfil_label = {
        "admin": "Administrador",
        "operador": "Operador",
        "visualizador": "Visualizador"
    }.get(st.session_state.usuario_perfil, st.session_state.usuario_perfil)

    st.markdown(HEADER, unsafe_allow_html=True)
    st.success(f"Olá, **{st.session_state.usuario_nome}** — {perfil_label}")
    st.markdown("Use o menu lateral para navegar entre as telas.")
    if st.button("🚪 Sair", use_container_width=True):
        fazer_logout()
        st.rerun()
else:
    st.markdown(HEADER, unsafe_allow_html=True)
    with st.form("form_login"):
        login = st.text_input("Usuário", placeholder="seu.login")
        senha = st.text_input("Senha", type="password")
        entrar = st.form_submit_button("Entrar", use_container_width=True, type="primary")
    if entrar:
        if fazer_login(login, senha):
            st.rerun()
        else:
            st.error("Usuário ou senha incorretos.")

st.markdown('<div class="dev-credit">Desenvolvido por Daniel Dias de Santana</div>', unsafe_allow_html=True)
