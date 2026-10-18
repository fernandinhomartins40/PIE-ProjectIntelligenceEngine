# Diferenças PIE em relação ao upstream REA

## Snapshot da divergência — 18/10/2026

Fetch observado: upstream `eb2c3b589eeb2884761b30d5b0402aa2d9337b49`, PIE `951755e1fba4588e9a36bbd78e216fafde283f52`, fork `d200b8618d85aecffc359d29a908438a7da28749`. A contagem `upstream/main...HEAD` é `113 239`. O fork é ancestral do HEAD. Simulação de merge identificou quatro conflitos em `src/process/ProviderProcess.ts`, seu teste unitário, boundary de processo e fixture MJS. Nenhuma integração foi feita nesta diligência. A análise anterior abaixo é histórica e não cobre os commits posteriores a `926e18b3f`.

## Atualização incremental — 18/10/2026

Refs após fetch naquele registro: `upstream/main=23f984b1a`; cherry-pick seletivo `093ce695f` entrou na main PIE como `068815b30`. O delta observado então era 104 commits; este snapshot mais recente registra 113 commits upstream-only. A comparação histórica de `c12d9eda8` abaixo não cobre nenhum dos deltas posteriores. Ownership de temporários foi validado com Node 24.18, 7 testes; veja `docs/UPSTREAM_REA_AUDIT.md` e `docs/PIE_VALIDATION_REPORT.md`.

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

## Revalidação atual dos refs — 18/10/2026

Registro substituído pelo snapshot atual no início deste documento. Na medição antiga, HEAD era `80872c6ea`, upstream `c12d9eda8` e o delta 101/215; estes valores são históricos e não representam os refs atuais. Nenhum merge/cherry-pick foi feito naquele registro.
