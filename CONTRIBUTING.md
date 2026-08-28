# Contribuindo para o Fire Workspace

Projeto da **Fire Play**. Obrigado por considerar contribuir.

## Reportando bugs

Abra uma issue descrevendo:

- o que aconteceu vs. o que era esperado;
- passos para reproduzir;
- o runtime (local / Vercel / Hostinger / outro);
- logs relevantes (sem credenciais).

## Reportando problemas de segurança

**Não abra issues de segurança publicamente.** Siga o fluxo privado em
[.github/SECURITY.md](./.github/SECURITY.md).

## Pull requests

Regras gerais:

- Branch a partir da `main` mais recente.
- Rode `npm run typecheck`, `npm run lint` e `npm run format` antes de
  enviar.
- Uma mudança lógica por PR.
- A primeira linha da mensagem de commit é imperativa e curta; o corpo
  explica o _porquê_, o diff mostra o _o quê_.

## Dev-loop

| Comando                | O que faz                                      |
| ---------------------- | ---------------------------------------------- |
| `npm run dev`          | Servidor de dev Turbopack na porta 3000.       |
| `npm run build`        | Build de produção. Next também roda typecheck. |
| `npm run typecheck`    | `tsc --noEmit`.                                |
| `npm run lint`         | ESLint.                                        |
| `npm run format`       | Prettier write.                                |
| `npm run format:check` | Prettier em modo check. Útil em CI.            |
| `npm run test`         | Vitest.                                        |

## Licença

MIT ([`LICENSE`](./LICENSE)). Suas contribuições são assumidas MIT.
