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
import { Entity } from '@backstage/catalog-model';

export interface TechDocsEntity {
  name: string;
  tags: Array<string>;
  description: string;
  owner: string;
  lifecycle: string;
  namespace: string;
  title: string;
  kind: string;
}

export interface TechDocsEntityWithUrls extends TechDocsEntity {
  techDocsUrl: string;
  metadataUrl: string;
}

export interface ListTechDocsOptions {
  entityType?: string;
  namespace?: string;
  owner?: string;
  lifecycle?: string;
  tags?: string[];
  limit?: number;
}

export interface TechDocsCoverageResult {
  totalEntities: number;
  entitiesWithDocs: number;
  coveragePercentage: number;
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
   * Generate TechDocs URLs for a given entity
   */
  async generateTechDocsUrls(
    entity: Entity,
  ): Promise<{ techDocsUrl: string; metadataUrl: string }> {
    // Use the configured frontend base URL from config
    const appBaseUrl = this.config.getString('app.baseUrl');
    const backendBaseUrl = await this.discovery.getBaseUrl('catalog');

    const { namespace = 'default', name } = entity.metadata;
    const kind = entity.kind.toLowerCase();

    return {
      techDocsUrl: `${appBaseUrl}/docs/${namespace}/${kind}/${name}`,
      metadataUrl: `${backendBaseUrl}/entities/by-name/${kind}/${namespace}/${name}`,
    };
  }

  /**
   * Analyze documentation coverage across all entities
   */
  async analyzeCoverage(
    options: ListTechDocsOptions = {},
    auth: any,
    catalog: CatalogService,
  ): Promise<TechDocsCoverageResult> {
    const {
      entityType,
      namespace,
      owner,
      lifecycle,
      tags,
      limit = 500,
    } = options;
    const credentials = await auth.getOwnServiceCredentials();

    this.logger.info('Analyzing TechDocs coverage...');

    // Build filters for catalog query
    const filters: Record<string, string | string[]> = {};
    if (entityType) {
      filters.kind = entityType;
    }
    if (namespace) {
      filters['metadata.namespace'] = namespace;
    }
    if (owner) {
      filters['spec.owner'] = owner;
    }
    if (lifecycle) {
      filters['spec.lifecycle'] = lifecycle;
    }
    if (tags) {
      filters['metadata.tags'] = tags;
    }

    const getEntitiesOptions: any = {
      filter: Object.keys(filters).length > 0 ? filters : undefined,
      fields: [
        'kind',
        'metadata.namespace',
        'metadata.name',
        'metadata.annotations',
      ],
      limit,
    };

    const resp = await catalog.getEntities(getEntitiesOptions, { credentials });
    const totalEntities = resp.items.length;

    // Count entities with TechDocs
    const entitiesWithDocs = resp.items.filter(
      entity => entity.metadata?.annotations?.['backstage.io/techdocs-ref'],
    ).length;

    const coveragePercentage =
      totalEntities > 0 ? (entitiesWithDocs / totalEntities) * 100 : 0;

    this.logger.info(
      `Coverage analysis complete: ${entitiesWithDocs}/${totalEntities} entities (${coveragePercentage.toFixed(
        1,
      )}%) have TechDocs`,
    );

    return {
      totalEntities,
      entitiesWithDocs,
      coveragePercentage: Math.round(coveragePercentage * 10) / 10, // Round to 1 decimal place
    };
  }

  /**
   * List all entities that have TechDocs available
   */
  async listTechDocs(
    options: ListTechDocsOptions = {},
    auth: any,
    catalog: CatalogService,
  ): Promise<{ entities: TechDocsEntityWithUrls[] }> {
    const {
      entityType,
      namespace,
      owner,
      lifecycle,
      tags,
      limit = 500,
    } = options;
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
    if (owner) {
      filters['spec.owner'] = owner;
    }
    if (lifecycle) {
      filters['spec.lifecycle'] = lifecycle;
    }
    if (tags) {
      filters['metadata.tags'] = tags;
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

    // Filter entities that have techdocs-ref annotation and generate URLs
    const entitiesWithTechDocs = resp.items.filter(
      entity => entity.metadata?.annotations?.['backstage.io/techdocs-ref'],
    );

    const entities = await Promise.all(
      entitiesWithTechDocs.map(async entity => {
        const urls = await this.generateTechDocsUrls(entity);
        return {
          name: entity.metadata.name,
          title: entity.metadata.title || '',
          tags: entity.metadata.tags || [],
          description: entity.metadata.description || '',
          owner: String(entity.metadata.owner || entity.spec?.owner || ''),
          lifecycle: String(
            entity.metadata.lifecycle || entity.spec?.lifecycle || '',
          ),
          namespace: entity.metadata.namespace || 'default',
          kind: entity.kind,
          techDocsUrl: urls.techDocsUrl,
          metadataUrl: urls.metadataUrl,
        };
      }),
    );

    this.logger.info(
      `Successfully found ${entities.length} entities with TechDocs`,
    );

    return { entities };
  }
}
