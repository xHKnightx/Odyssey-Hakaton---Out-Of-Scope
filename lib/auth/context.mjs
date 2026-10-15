import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

export const runWithUser = (user, fn) => storage.run({ user }, fn);
export const currentUser = () => storage.getStore()?.user || null;
