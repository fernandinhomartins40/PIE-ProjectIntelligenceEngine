# Diferenças PIE em relação ao upstream REA

## Base e método

Comparação observada em 17/10/2026 dentro do checkout local:

- Upstream: `morluto/rea`, `upstream/main` em `926e18b3fcb334c21d60685546ba8145d35d344e`.
- HEAD comparado: `4451f1fc4647f8d1ed7578b1a3d0f939adb285db`.
- `git rev-list --left-right --count upstream/main...HEAD`: `0 80`; upstream é ancestral e tem zero commits somente no upstream em relação ao checkout.
- `git diff --shortstat upstream/main...HEAD`: 173 arquivos, 51.949 inserções, 103 remoções.
- Método: comparação de árvore Git por ancestral comum, inventário de nomes/status e leitura de manifests, migrations, adapters e documentação. Não significa execução de cada capacidade.

## Natureza das diferenças

O delta concentra o produto PIE e suas dependências/registros: `src/pie/`, `apps/web/`, `prisma/`, `compose.pie.yml`, dispatcher `scripts/pie.mjs`, workflow `.github/workflows/pie.yml`, documentação `README_PIE.md` e `docs/PIE_*`, testes `tests/boundary/pie*.test.ts`, dependências Prisma/PostgreSQL, React e PHP parser, e atualização de `package-lock.json`/notices. `playwright-core` já existia no upstream e não é contado como delta. O código e o entrypoint REA foram preservados; o PIE usa namespace e superfície separada. As alterações de terceiros são inventariadas em `licenses/npm-dependencies.txt`, `licenses/npm-runtime-notices.txt` e `THIRD_PARTY_NOTICES.md`.

## Licenças e limitações

O repositório mantém a licença upstream MIT e notices identificados. `THIRD_PARTY_NOTICES.md` declara sete identidades de archives sem notice autônomo reconhecido (`UPSTREAM_NOTICE_GAP`), revisão de fonte/distribuição pendente; a consistência automática do inventário não equivale a parecer jurídico nem a inventário legal completo. Ferramentas comerciais de análise são bring-your-own e seus direitos não são concedidos pela MIT.

## Estado e atualização

`origin/main` é o projeto PIE independente e `rea-fork/main` é o fork autorizado `fernandinhomartins40/rea`; ambos estavam no HEAD comparado durante a verificação. `upstream/main` permanece ancestral. Nenhum commit upstream-only foi integrado depois do SHA observado sem nova atualização deste relatório; antes de atualizar REA, refazer fetch, diff, testes aplicáveis, revisão de licenças e validação de conflitos. CI pendente ou em execução é evidência distinta de validação local.
