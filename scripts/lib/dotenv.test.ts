import { describe, expect, test } from "bun:test";
import { parseDotEnv } from "./dotenv";

describe("parseDotEnv", () => {
  test("parses bare, quoted and exported values", () => {
    const env = parseDotEnv(
      [
        "# comment",
        "",
        "PLAIN=value",
        "SPACED = spaced value  # trailing comment",
        'DOUBLE="has # hash\\nnewline"',
        "SINGLE='raw\\n'",
        "export EXPORTED=yes",
        "EMPTY=",
        "URL=postgres://u:p@localhost:5433/db?sslmode=disable",
        "not a pair",
      ].join("\r\n"),
    );

    expect(env).toEqual({
      PLAIN: "value",
      SPACED: "spaced value",
      DOUBLE: "has # hash\nnewline",
      SINGLE: "raw\\n",
      EXPORTED: "yes",
      EMPTY: "",
      URL: "postgres://u:p@localhost:5433/db?sslmode=disable",
    });
  });
});
