import { config } from "./config.js";
import { UserStore } from "./db.js";

let singleton: UserStore | undefined;
export const getUserStore = () => singleton ??= new UserStore(config.databasePath);

export const users = new Proxy({} as UserStore, {
  get: (_target, property) => {
    const store = getUserStore();
    const value = Reflect.get(store, property, store) as unknown;
    return typeof value === "function" ? value.bind(store) : value;
  }
});
