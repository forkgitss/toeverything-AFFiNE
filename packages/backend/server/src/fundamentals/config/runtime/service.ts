import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { difference, keyBy } from 'lodash-es';

import { Cache } from '../../cache';
import { defer } from '../../utils/promise';
import { defaultRuntimeConfig } from '../register';
import { AppRuntimeConfigModules, FlattenedAppRuntimeConfig } from '../types';

/**
 * runtime.fetch(k) // v1
 * runtime.fetchAll(k1, k2, k3) // [v1, v2, v3]
 * runtime.set(k, v)
 * runtime.update(k, (v) => {
 *   v.xxx = 'yyy';
 *   return v
 * })
 */

@Injectable()
export class Runtime implements OnApplicationBootstrap {
  logger = new Logger('App:RuntimeConfig');
  constructor(
    private readonly db: PrismaClient,
    private readonly cache: Cache
  ) {}

  async onApplicationBootstrap() {
    await this.upgradeDB();
  }

  async fetch<K extends keyof FlattenedAppRuntimeConfig>(
    k: K
  ): Promise<FlattenedAppRuntimeConfig[K]> {
    const cached = await this.loadCache<K>(k);

    if (cached) {
      return cached;
    }

    const dbValue = await this.loadDb<K>(k);

    if (!dbValue) {
      throw new Error(`Runtime config ${k} not found`);
    }

    await this.setCache(k, dbValue);

    return dbValue;
  }

  async fetchAll<
    Selector extends { [Key in keyof FlattenedAppRuntimeConfig]?: true },
  >(
    selector: Selector
  ): Promise<{
    // @ts-expect-error allow
    [Key in keyof Selector]: FlattenedAppRuntimeConfig[Key];
  }> {
    const keys = Object.keys(selector);

    if (keys.length === 0) {
      return {} as any;
    }

    const records = await this.db.appRuntimeSetting.findMany({
      select: {
        id: true,
        value: true,
      },
      where: {
        id: {
          in: keys,
        },
      },
    });

    const keyed = keyBy(records, 'id');
    return keys.reduce((ret, key) => {
      ret[key] = keyed[key]?.value ?? defaultRuntimeConfig[key].value;
      return ret;
    }, {} as any);
  }

  async list(module?: AppRuntimeConfigModules) {
    return await this.db.appRuntimeSetting.findMany({
      where: module ? { module, deletedAt: null } : { deletedAt: null },
    });
  }

  async set<
    K extends keyof FlattenedAppRuntimeConfig,
    V = FlattenedAppRuntimeConfig[K],
  >(key: K, value: V) {
    const setting = await this.db.appRuntimeSetting.upsert({
      where: {
        id: key,
      },
      create: {
        ...defaultRuntimeConfig[key],
        value: value as any,
      },
      update: {
        value: value as any,
      },
    });

    await this.setCache(key, setting.value as FlattenedAppRuntimeConfig[K]);
    return setting;
  }

  async update<
    K extends keyof FlattenedAppRuntimeConfig,
    V = FlattenedAppRuntimeConfig[K],
  >(k: K, modifier: (v: V) => V | Promise<V>) {
    const data = await this.fetch<K>(k);

    const updated = await modifier(data as V);

    await this.set(k, updated);

    return updated;
  }

  async loadDb<K extends keyof FlattenedAppRuntimeConfig>(
    k: K
  ): Promise<FlattenedAppRuntimeConfig[K] | undefined> {
    const v = await this.db.appRuntimeSetting.findFirst({
      where: {
        id: k,
        deletedAt: null,
      },
    });

    if (v) {
      return v.value as FlattenedAppRuntimeConfig[K];
    } else {
      const record = await this.db.appRuntimeSetting.create({
        data: defaultRuntimeConfig[k],
      });

      return record.value as any;
    }
  }

  async loadCache<K extends keyof FlattenedAppRuntimeConfig>(
    k: K
  ): Promise<FlattenedAppRuntimeConfig[K] | undefined> {
    return this.cache.get<FlattenedAppRuntimeConfig[K]>(`SERVER_RUNTIME:${k}`);
  }

  async setCache<K extends keyof FlattenedAppRuntimeConfig>(
    k: K,
    v: FlattenedAppRuntimeConfig[K]
  ): Promise<boolean> {
    return this.cache.set<FlattenedAppRuntimeConfig[K]>(
      `SERVER_RUNTIME:${k}`,
      v,
      { ttl: 60 * 1000 }
    );
  }

  /**
   * Upgrade the DB with latest runtime settings
   */
  private async upgradeDB() {
    const existingConfig = await this.db.appRuntimeSetting.findMany({
      select: {
        id: true,
      },
      where: {
        deletedAt: null,
      },
    });

    const defined = Object.keys(defaultRuntimeConfig);
    const existing = existingConfig.map(c => c.id);
    const newSettings = difference(defined, existing);
    const deleteSettings = difference(existing, defined);

    if (!newSettings.length && !deleteSettings.length) {
      return;
    }

    this.logger.log(`Found runtime config changes, upgrading...`);
    const acquired = await this.cache.setnx('runtime:upgrade', 1, {
      ttl: 10 * 60 * 1000,
    });
    await using _ = defer(async () => {
      await this.cache.delete('runtime:upgrade');
    });

    if (acquired) {
      for (const key of newSettings) {
        await this.db.appRuntimeSetting.upsert({
          create: defaultRuntimeConfig[key],
          // old deleted setting should be restored
          update: {
            ...defaultRuntimeConfig[key],
            deletedAt: null,
          },
          where: {
            id: key,
          },
        });
      }

      await this.db.appRuntimeSetting.updateMany({
        where: {
          id: {
            in: deleteSettings,
          },
        },
        data: {
          deletedAt: new Date(),
        },
      });
    }

    this.logger.log('Upgrade completed');
  }
}
