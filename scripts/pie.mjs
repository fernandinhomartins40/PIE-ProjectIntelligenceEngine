#!/usr/bin/env node
// Distinct PIE entrypoint; the original REA dispatcher remains compatible.
try {
  const { runPie } = await import("../dist/pie/cli.js");
  await runPie(process.argv.slice(2));
} catch (cause) {
  const known = cause && typeof cause === "object" && cause.name === "PieError";
  console.error(
    JSON.stringify({
      error: {
        code: known ? cause.code : "START_OR_INPUT_ERROR",
        message: known
          ? cause.message
          : "Falha ao iniciar ou entrada inválida. Compile o PIE e confira help e doctor.",
      },
    }),
  );
  process.exitCode = 1;
}
