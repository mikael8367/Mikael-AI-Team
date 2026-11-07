# Mikael AI Team

Aplicativo mobile-first para debates colaborativos entre até sete provedores de IA, com seleção individual, contexto compartilhado e síntese final.

## Provedores integrados

- OpenAI / ChatGPT
- Google Gemini
- Groq
- OpenRouter
- DeepSeek
- Mistral AI
- Claude / Anthropic

A integração não significa que todas as APIs sejam gratuitas. Cada provedor exige sua própria chave e está sujeito a preços, cotas, disponibilidade e termos do respectivo serviço. Alguns modelos do Groq, Gemini e OpenRouter podem oferecer cotas gratuitas, que mudam com o tempo. Verifique as condições diretamente com cada provedor.

## Como funciona o debate

- **Escolher minhas IAs:** selecione uma ou mais IAs configuradas no servidor.
- **Automático:** usa todas as IAs com chave configurada; se uma falhar por limite de créditos/cota, registra a indisponibilidade e continua com as demais.
- Cada participante recebe a tarefa e o histórico compartilhado das respostas anteriores.
- A última IA que participou faz a síntese final.
- O histórico identifica o provedor que realmente respondeu. Uma falha nunca é apresentada como participação concluída.
- Limite de 1 a 4 rodadas.

## Configurar no Render

Configure em **Dashboard → serviço → Environment** somente as chaves dos provedores que pretende usar:

| Variável | Provedor |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI |
| `GEMINI_API_KEY` | Google Gemini |
| `GROQ_API_KEY` | Groq |
| `OPENROUTER_API_KEY` | OpenRouter |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `MISTRAL_API_KEY` | Mistral |
| `ANTHROPIC_API_KEY` | Claude |

Modelos podem ser substituídos por variáveis opcionais: `OPENAI_MODEL`, `GEMINI_MODEL`, `GROQ_MODEL`, `OPENROUTER_MODEL`, `DEEPSEEK_MODEL`, `MISTRAL_MODEL` e `CLAUDE_MODEL`.

Também são necessárias `APP_ACCESS_PASSWORD` e `SESSION_SECRET`. O blueprint Render gera o segredo de sessão automaticamente. Não coloque chaves no frontend, no APK, em commits ou em mensagens. Não compartilhe credenciais no chat.

## Deploy

1. Publique este repositório como serviço Node no Render usando `render.yaml`.
2. Configure as variáveis de ambiente acima para os provedores desejados.
3. Aguarde o deploy e abra `/api/health` para conferir quais provedores estão configurados. A resposta informa apenas estado e modelo, nunca as chaves.
4. Abra o endereço HTTPS do serviço para usar a interface.

## APK Android pelo celular

1. Em GitHub → Settings → Secrets and variables → Actions → Variables, crie `API_BASE_URL` com a URL HTTPS do Render, sem barra no final.
2. Em Actions, abra o workflow **Android APK** e execute **Run workflow**.
3. Quando a execução terminar, baixe o artefato `Mikael-AI-Team-debug`.

O APK depende do backend online. A criação do APK é uma etapa separada; este commit não gera nem publica APK automaticamente.

## Desenvolvimento e testes

```bash
npm install
npm run check
npm test
npm start
```

Nunca publique chaves de API, senhas ou tokens.
