@echo off
cd /d "C:\Users\daniel.santana\Documents\DANIEL\BD_MATERIAIS\CONSTRUCT"

echo ==============================================
echo   CONSTRUCT — Instalacao Inicial
echo ==============================================
echo.

:: Cria ambiente virtual
echo [1/4] Criando ambiente virtual Python...
python -m venv venv
if errorlevel 1 (
    echo [ERRO] Python nao encontrado. Instale o Python 3.10 ou superior.
    pause
    exit /b 1
)

:: Instala dependências
echo [2/4] Instalando dependencias...
venv\Scripts\pip install --upgrade pip
venv\Scripts\pip install -r requirements.txt
if errorlevel 1 (
    echo [ERRO] Falha ao instalar dependencias.
    pause
    exit /b 1
)

:: Verifica .env
echo [3/4] Verificando configuracao...
if not exist ".env" (
    copy .env.example .env
    echo.
    echo [AVISO] Arquivo .env criado a partir do .env.example
    echo         EDITE o arquivo .env e configure o DATABASE_URL com
    echo         a string de conexao do seu banco Supabase.
    echo.
    echo         Pressione qualquer tecla para abrir o .env no Bloco de Notas...
    pause
    notepad .env
)

:: Executa seed
echo [4/4] Criando tabelas e dados iniciais no banco...
venv\Scripts\python seed.py
if errorlevel 1 (
    echo [ERRO] Falha ao executar o seed. Verifique o DATABASE_URL no .env
    pause
    exit /b 1
)

echo.
echo ==============================================
echo   Instalacao concluida com sucesso!
echo   Execute Run.bat para iniciar o sistema.
echo ==============================================
echo.
pause
