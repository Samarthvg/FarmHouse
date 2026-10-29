import type { Me } from '../shared/types.ts';

export interface AppEnv {
  Bindings: { DB: D1Database };
  Variables: { user: Me };
}
