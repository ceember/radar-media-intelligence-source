/** Model prose and older saved prose cannot impersonate the code-owned evidence labels. */
export const neutralNewsjackText = (text:string) => text.replace(/\b(?:verif\w*|confirm\w*|corroborat\w*|supported|factual|disputed|unverifiable|missing[- ]source)\b/gi,'source check required');
