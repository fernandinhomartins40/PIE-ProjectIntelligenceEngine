import type { AdapterRead, Declaration } from "./contracts.js";
import { nginxDirectives } from "./nginxSyntax.js";

const selected = new Set([
  "listen",
  "server_name",
  "proxy_pass",
  "fastcgi_pass",
  "grpc_pass",
  "include",
]);

/** Transport userinfo is authentication; retain the remaining URI without URL normalization. */
const redactTransport = (value: string) =>
  value.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, "$1[REDACTED]@");

export function readNginx(source: string, limit: number): AdapterRead {
  const declarations: Declaration[] = [];
  let omitted = 0;
  let includes = 0;
  for (const directive of nginxDirectives(source)) {
    const [command, ...args] = directive.words;
    const kind =
      directive.block && command === "location"
        ? "location"
        : !directive.block && selected.has(command!)
          ? "config_directive"
          : null;
    if (!kind) continue;
    if (command === "include") includes++;
    if (!args.length) throw new Error("Nginx directive missing arguments");
    const transport = ["proxy_pass", "grpc_pass", "fastcgi_pass"].includes(
      command!,
    );
    const name = JSON.stringify([
      command,
      ...(transport ? args.map(redactTransport) : args),
    ]);
    const parent = JSON.stringify(
      directive.ancestors.map((item) => ({
        directive: item.words[0],
        line: item.line,
      })),
    );
    if (
      declarations.length >= limit ||
      name.length > 1000 ||
      parent.length > 1000
    ) {
      omitted++;
      continue;
    }
    declarations.push({
      adapter: "nginx-config",
      kind,
      name,
      parent,
      line: directive.line,
    });
  }
  return {
    declarations,
    limitations: [
      "Lexer Nginx: diretivas selecionadas com argumentos preservados em array JSON e contexto por linha; não valida módulos, semântica, herança, precedência de locations, TLS, permissões ou configuração efetiva do servidor.",
      "Variáveis e destinos permanecem valores declarados; nenhum arquivo externo, URL, socket ou include é acessado. Sem comprovação de escuta, proxy ou disponibilidade HTTP.",
      "Userinfo de autenticação em URI de transporte é redigido; demais valores selecionados não são tratados como secretos por inferência de nomes.",
      ...(includes
        ? [
            `${includes} diretivas include não expandidas; contexto/configuração podem estar incompletos.`,
          ]
        : []),
      ...(omitted
        ? [
            `${omitted} declarações Nginx omitidas por limite de recursos/identificador.`,
          ]
        : []),
    ],
  };
}
