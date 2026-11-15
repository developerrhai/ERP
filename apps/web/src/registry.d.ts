// Types for the menu registry JSON imported through the @registry Vite alias
// (packages/registry/registry.json), so the web app never keeps its own copy.

declare module '@registry' {
  export interface RegistryItem {
    id: string;
    title: string;
  }
  export interface RegistryFamily {
    name: string;
    icon: string;
    items: RegistryItem[];
  }
  export interface RegistryProfile {
    title: string;
    family: string;
    purpose: string;
    tabs: string[];
    fields: string[];
  }
  export interface Registry {
    families: RegistryFamily[];
    profiles: Record<string, RegistryProfile | undefined>;
    deptFamilies: Record<string, string[] | undefined>;
    departments: string[];
  }
  const registry: Registry;
  export default registry;
}

// The V40 page list (packages/registry/registry.v2.json, extracted from the approved V40 file): tab names per page.
declare module '@registry-v2' {
  const data: { pages: { id: string; title: string; family: string; tabs: string[]; fields: string[]; buttons: string[] }[] };
  export default data;
}
