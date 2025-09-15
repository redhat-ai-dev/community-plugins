/*
 * Copyright 2025 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { LoggerService, DiscoveryService } from '@backstage/backend-plugin-api';
import type { Config } from '@backstage/config';
import { Publisher, PublisherBase } from '@backstage/plugin-techdocs-node';
import { CatalogService } from '@backstage/plugin-catalog-node';

export interface TechDocsEntity {
  name: string;
  tags: Array<string>;
  description: string;
  owner: string;
  lifecycle: string;
  namespace?: string;
  title: string;
}

export interface TechDocsEntityWithUrls extends TechDocsEntity {
  techDocsUrl: string;
  metadataUrl: string;
}

export interface ListTechDocsOptions {
  entityType?: string;
  namespace?: string;
  limit?: number;
}

export class TechDocsService {
  private publisher?: PublisherBase;

  constructor(
    private config: Config,
    private logger: LoggerService,
    private discovery: DiscoveryService,
  ) {}

  async initialize() {
    this.publisher = await Publisher.fromConfig(this.config, {
      logger: this.logger,
      discovery: this.discovery,
    });
  }

  async getPublisher(): Promise<PublisherBase> {
    if (!this.publisher) {
      await this.initialize();
    }
    return this.publisher!;
  }

  /**
   * List all entities that have TechDocs available
   */
  async listTechDocs(
    options: ListTechDocsOptions = {},
    auth: any,
    catalog: CatalogService,
  ): Promise<{ entities: TechDocsEntity[] }> {
    const { entityType, namespace, limit = 500 } = options;
    const credentials = await auth.getOwnServiceCredentials();

    this.logger.info('Fetching entities from catalog...');

    // Build filters for catalog query - filter for entities with techdocs-ref annotation
    const filters: Record<string, string | string[]> = {};
    if (entityType) {
      filters.kind = entityType;
    }
    if (namespace) {
      filters['metadata.namespace'] = namespace;
    }

    const getEntitiesOptions: any = {
      filter: Object.keys(filters).length > 0 ? filters : undefined,
      fields: [
        'kind',
        'metadata.namespace',
        'metadata.name',
        'metadata.title',
        'metadata.annotations',
        'metadata.tags',
        'metadata.description',
        'metadata.owner',
        'metadata.lifecycle',
        'spec.lifecycle',
        'spec.owner',
      ],
      limit,
    };

    const resp = await catalog.getEntities(getEntitiesOptions, { credentials });

    this.logger.info(
      `Found ${resp.items.length} entities, filtering for techdocs-ref annotation`,
    );

    // Filter entities that have techdocs-ref annotation
    const entities = resp.items
      .filter(
        entity => entity.metadata?.annotations?.['backstage.io/techdocs-ref'],
      )
      .map(entity => ({
        name: entity.metadata.name,
        title: entity.metadata.title || '',
        tags: entity.metadata.tags || [],
        description: entity.metadata.description || '',
        owner: String(entity.metadata.owner || entity.spec?.owner || ''),
        lifecycle: String(
          entity.metadata.lifecycle || entity.spec?.lifecycle || '',
        ),
      }));

    this.logger.info(
      `Successfully found ${entities.length} entities with TechDocs`,
    );

    return { entities };
  }
}
