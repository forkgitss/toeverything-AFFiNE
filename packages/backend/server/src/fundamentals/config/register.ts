import { Prisma } from '@prisma/client';
import { get, merge, set } from 'lodash-es';

import {
  AppModulesConfigDef,
  AppStartupConfig,
  ModuleRuntimeConfigDescriptions,
  ModuleStartupConfigDescriptions,
} from './types';

export const defaultStartupConfig: AppStartupConfig = {} as any;
export const defaultRuntimeConfig: Record<
  string,
  Prisma.AppRuntimeSettingCreateInput
> = {} as any;

function registerRuntimeConfig<T extends keyof AppModulesConfigDef>(
  module: T,
  configs: ModuleRuntimeConfigDescriptions<T>
) {
  Object.entries(configs).forEach(([key, value]) => {
    defaultRuntimeConfig[`${module}/${key}`] = {
      id: `${module}/${key}`,
      module,
      key,
      description: value.desc,
      value: value.default,
    };
  });
}

export function defineStartupConfig<T extends keyof AppModulesConfigDef>(
  module: T,
  configs: ModuleStartupConfigDescriptions<AppModulesConfigDef[T]>
) {
  set(
    defaultStartupConfig,
    module,
    merge(get(defaultStartupConfig, module, {}), configs)
  );
}

export function defineRuntimeConfig<T extends keyof AppModulesConfigDef>(
  module: T,
  configs: ModuleRuntimeConfigDescriptions<T>
) {
  registerRuntimeConfig(module, configs);
}
