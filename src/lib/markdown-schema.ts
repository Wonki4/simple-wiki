import { defaultSchema } from "rehype-sanitize";

// Reading and live editing use the same safe HTML attributes and protocols.
export const markdownSchema: typeof defaultSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []).filter(item => !Array.isArray(item) || item[0] !== "className"),
      ["className", "wiki-link", "wiki-link-missing"]],
    code: [...(defaultSchema.attributes?.code ?? []).filter(item => !Array.isArray(item) || item[0] !== "className"),
      ["className", /^language-./]],
  },
};
