# Mikael AI Team

Aplicativo mobile-first para colaboração entre ChatGPT (OpenAI) e Gemini (Google), com debate estruturado, contexto compartilhado e revisão de código.

## Estado inicial

Este repositório está sendo preparado para um MVP seguro. As chaves das APIs devem permanecer exclusivamente no servidor, em variáveis de ambiente.

## Tecnologias planejadas

- Node.js + Express para a API
- Interface web responsiva, preparada para Android via Capacitor
- OpenAI API e Gemini API chamadas somente pelo backend
- GitHub Actions para testes e futura compilação Android

## Configuração

1. Copie `.env.example` para `.env`.
2. Configure `OPENAI_API_KEY`, `GEMINI_API_KEY` e `APP_ACCESS_PASSWORD` no ambiente do servidor. Gere um valor longo e aleatório para `SESSION_SECRET`.
3. Instale as dependências com `npm install`.
4. Execute `npm start`.

Nunca publique chaves de API no frontend, no Git ou em logs.
