import Ajv from "ajv";
import { UsageError } from "./errors.mjs";

const amount = {
  type: "object",
  additionalProperties: false,
  required: ["amount", "unit"],
  properties: {
    amount: { type: "number", exclusiveMinimum: 0 },
    unit: { enum: ["g", "ml", "piece"] },
  },
};

const portion = {
  type: "object",
  additionalProperties: false,
  required: ["name", "amount", "unit"],
  properties: {
    name: { type: "string", minLength: 1 },
    amount: { type: "number", exclusiveMinimum: 0 },
    unit: { enum: ["g", "ml", "piece"] },
  },
};

const common = {
  schema_version: { const: 1 },
  name: { type: "string", minLength: 1 },
  aliases: { type: "array", items: { type: "string", minLength: 1 }, default: [] },
  portions: { type: "array", items: portion, default: [] },
  tags: { type: "array", items: { type: "string", minLength: 1 }, default: [] },
};

export const PRODUCT_SCHEMA = {
  $id: "https://kcal.local/schemas/product-v1.json",
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "kind", "name", "basis", "nutrients"],
  properties: {
    ...common,
    kind: { const: "food" },
    brand: { type: ["string", "null"] },
    barcodes: { type: "array", items: { type: "string", pattern: "^[0-9]{8,14}$" }, default: [] },
    state: { enum: ["as_sold", "dry", "cooked", "prepared", "unknown"], default: "unknown" },
    basis: amount,
    nutrients: {
      type: "object",
      required: ["energy_kcal", "protein_g", "fat_g", "carb_g", "fiber_g"],
      properties: {
        energy_kcal: { type: "number", minimum: 0 },
        protein_g: { type: "number", minimum: 0 },
        fat_g: { type: "number", minimum: 0 },
        carb_g: { type: "number", minimum: 0 },
        fiber_g: { type: ["number", "null"], minimum: 0 },
      },
      additionalProperties: false,
    },
    other_nutrients: { type: "object", additionalProperties: { type: ["number", "string", "null"] }, default: {} },
    category: { type: ["string", "null"] },
  },
};

export const RECIPE_SCHEMA = {
  $id: "https://kcal.local/schemas/recipe-v1.json",
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "kind", "name", "ingredients", "yield"],
  properties: {
    ...common,
    kind: { const: "recipe" },
    ingredients: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item_id", "amount", "unit"],
        properties: {
          item_id: { type: "string", pattern: "^(l|r|y|off|scan)::.+$" },
          amount: { type: "number", exclusiveMinimum: 0 },
          unit: { enum: ["g", "ml", "piece"] },
        },
      },
    },
    yield: amount,
  },
};

export const LABEL_SCHEMA = {
  name: "nutrition_label",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["name", "brand", "state", "basis", "nutrients", "portions", "barcodes", "category", "warnings", "needs_review"],
    properties: {
      name: { type: ["string", "null"] },
      brand: { type: ["string", "null"] },
      state: { enum: ["as_sold", "dry", "cooked", "prepared", "unknown"] },
      basis: {
        type: "object",
        additionalProperties: false,
        required: ["amount", "unit"],
        properties: {
          amount: { type: ["number", "null"] },
          unit: { enum: ["g", "ml", "piece", null] },
        },
      },
      nutrients: {
        type: "object",
        additionalProperties: false,
        required: ["energy_kj", "energy_kcal", "protein_g", "fat_g", "carb_g", "fiber_g"],
        properties: Object.fromEntries(["energy_kj", "energy_kcal", "protein_g", "fat_g", "carb_g", "fiber_g"].map((key) => [key, { type: ["number", "null"] }])),
      },
      portions: { type: "array", items: portion },
      barcodes: { type: "array", items: { type: "string" } },
      category: { type: ["string", "null"] },
      warnings: { type: "array", items: { type: "string" } },
      needs_review: { type: "boolean" },
    },
  },
};

const ajv = new Ajv({ allErrors: true, useDefaults: true, strict: false });
const productValidator = ajv.compile(PRODUCT_SCHEMA);
const recipeValidator = ajv.compile(RECIPE_SCHEMA);
const labelValidator = ajv.compile(LABEL_SCHEMA.schema);

function validate(validator, value, label) {
  if (validator(value)) return value;
  throw new UsageError(`${label} does not match schema`, {
    validation_errors: validator.errors.map((error) => ({ path: error.instancePath || "/", message: error.message })),
  });
}

export const validateProduct = (value) => validate(productValidator, value, "product");
export const validateRecipe = (value) => validate(recipeValidator, value, "recipe");
export const validateLabel = (value) => validate(labelValidator, value, "label recognition result");
