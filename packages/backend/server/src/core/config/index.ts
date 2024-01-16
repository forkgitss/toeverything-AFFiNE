import './config';

import { Module } from '@nestjs/common';

import { ServerConfigResolver } from './resolver';

@Module({
  providers: [ServerConfigResolver],
})
export class ServerConfigModule {}
export { ADD_ENABLED_FEATURES, ServerConfigType } from './resolver';
export { ServerFeature } from './types';
