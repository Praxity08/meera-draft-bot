// Reads config in both runtimes: Node (local scripts, tests) and Deno (Supabase edge function).
export const env = (name) => globalThis.Deno?.env.get(name) ?? globalThis.process?.env?.[name];
