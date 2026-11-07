# Mikael AI Team

Aplicativo mobile-first para colaboração entre ChatGPT (OpenAI) e Gemini (Google), com debate estruturado, contexto compartilhado e revisão final.

## Recursos atuais

- Interface responsiva com abas inferiores animadas: Início, Conversa e Configurações.
- ChatGPT atua como desenvolvedora; Gemini como revisora independente.
- Histórico compartilhado entre as rodadas e síntese final do ChatGPT.
- Limite de 1 a 4 rodadas por debate.
- Cancelamento do debate também interrompe as chamadas externas.
- Chaves de API mantidas somente no servidor.
- Senha de acesso e sessões assinadas com validade de 12 horas.
- Rate limit, limite de tamanho das tarefas e validação dos dados.
- Workflow de CI e workflow manual de compilação Android.

## Publicar o backend

1. Crie um serviço no Render usando este repositório e o arquivo `render.yaml`.
2. Configure as variáveis `OPENAI_API_KEY`, `GEMINI_API_KEY` e `APP_ACCESS_PASSWORD`.
3. O Render gera `SESSION_SECRET) automaticamente pelo blueprint.
4. Aguarde o deploy e teste `https://SEU-SERVICO.onrender.com/api/health`.

Use uma senha longa para `APP_ACCESS_PASSWORD`. As chaves das APIs nunca devem ser colocadas no app, em arquivos públicos ou no Git.

## Gerar o APK pelo celular

1. Abra as configurações do repositório no GitHub.
2. Em **Secrets and variables → Actions → Variables**, crie `API_BASE_URL` com a URL HTTPS pública do serviço Render, sem barra no final.
3. Abra **Actions → Android APK → Run workflow**.
4. Quando terminar, abra a execução e baixe o artefato `Mikael-AI-Team-debug`.

O APK só pode funcionar conectado ao backend publicado. A compilação ainda depende da configuração das chaves e da URL pública.

## Desenvolvimento local

1. Copie `.env.example` para `.env`.
2. Configure `OPENAI_API_KEY`, `GEMINI_API_KEY` e `APP_ACCESS_PASSWORD`.
3. Defina um valor aleatório e forte para `SESSION_SECRET`.
4. Execute `npm install`, depois `npm run check`, `npm test` e `npm start`.

Nunca publique chaves de API, senhas ou tokens.
