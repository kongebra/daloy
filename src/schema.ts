/**
 * Standard Schema v1 — minimal subset.
 * https://github.com/standard-schema/standard-schema
 *
 * By coding to this interface, DaloyJS supports Zod, Valibot, ArkType,
 * TypeBox-as-StandardSchema, and any future validator that exposes
 * `~standard`. No vendor lock-in.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown
    ) => Result<Output> | Promise<Result<Output>>;
    readonly types?: Types<Input, Output>;
  }

  export type Result<Output> = SuccessResult<Output> | FailureResult;

  export interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }

  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
  }

  export interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegment>;
  }

  export interface PathSegment {
    readonly key: PropertyKey;
  }

  export interface Types<Input, Output> {
    readonly input: Input;
    readonly output: Output;
  }

  export type InferInput<S extends StandardSchemaV1> =
    NonNullable<S["~standard"]["types"]>["input"];
  export type InferOutput<S extends StandardSchemaV1> =
    NonNullable<S["~standard"]["types"]>["output"];
}

/**
 * Run a Standard-Schema validator over an arbitrary input. Awaits async
 * validators automatically and returns the spec-defined
 * `{ value }` / `{ issues }` result.
 *
 * DaloyJS calls this internally for every declared request schema; you can
 * also use it directly inside hooks or business logic.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { validate } from "@daloyjs/core";
 *
 * const schema = z.object({ name: z.string() });
 * const result = await validate(schema, { name: "Ada" });
 * if (result.issues) throw new Error(result.issues[0].message);
 * console.log(result.value.name);
 * ```
 *
 * @param schema - Any Standard-Schema-compatible validator.
 * @param value - The value to validate.
 * @returns Fulfills with the validation result.
 * @since 0.1.0
 */
export async function validate<S extends StandardSchemaV1>(
  schema: S,
  value: unknown
): Promise<StandardSchemaV1.Result<StandardSchemaV1.InferOutput<S>>> {
  const r = schema["~standard"].validate(value);
  return r instanceof Promise ? r : (r as any);
}

/**
 * Duck-typed runtime check that an unknown value looks like a Standard
 * Schema validator (has a `~standard.validate` function). Useful in helpers
 * that accept either a schema or a raw value.
 *
 * @param x - Value to test.
 * @returns `true` when `x` exposes the Standard Schema contract.
 * @since 0.1.0
 */
export function isStandardSchema(x: unknown): x is StandardSchemaV1 {
  return (
    !!x &&
    typeof x === "object" &&
    "~standard" in (x as object) &&
    typeof (x as any)["~standard"]?.validate === "function"
  );
}
