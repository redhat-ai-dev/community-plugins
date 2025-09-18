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
import {
  Publisher,
  PublisherBase,
  TechDocsMetadata,
} from '@backstage/plugin-techdocs-node';
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

export interface TechDocsEntityWithMetadata extends TechDocsEntityWithUrls {
  metadata?: {
    lastUpdated?: string;
    buildTimestamp?: number;
    siteName?: string;
    siteDescription?: string;
    etag?: string;
    files?: string[];
  };
}

export interface TechDocsContentResult {
  entityRef: string;
  name: string;
  title: string;
  kind: string;
  namespace: string;
  content: string;
  pageTitle?: string;
  lastModified?: string;
  path?: string;
  contentType: 'markdown' | 'html' | 'text';
  metadata?: {
    lastUpdated?: string;
    buildTimestamp?: number;
    siteName?: string;
    siteDescription?: string;
  };
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
    private fetchFunction?: any,
  ) {}

  private getStaticToken(): string | undefined {
    try {
      // Try to get the static token from backend.auth.externalAccess
      const externalAccess = this.config.getOptionalConfigArray(
        'backend.auth.externalAccess',
      );
      if (externalAccess) {
        for (const access of externalAccess) {
          if (access.getString('type') === 'static') {
            return access.getOptionalString('options.token');
          }
        }
      }
    } catch (error) {
      this.logger.debug('Could not retrieve static token from config', error);
    }
    return undefined;
  }

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
   * Fetch TechDocs metadata for a given entity
   */
  async fetchTechDocsMetadata(
    entity: Entity,
  ): Promise<TechDocsMetadata | null> {
    try {
      const publisher = await this.getPublisher();
      const { namespace = 'default', name } = entity.metadata;
      const kind = entity.kind.toLowerCase();

      const entityName = {
        kind,
        namespace,
        name,
      };

      const metadata = await publisher.fetchTechDocsMetadata(entityName);
      return metadata;
    } catch (error) {
      this.logger.warn(
        `Failed to fetch TechDocs metadata for ${entity.kind}:${entity.metadata.namespace}/${entity.metadata.name}`,
        error,
      );
      return null;
    }
  }

  /**
   * Retrieve TechDocs content for a specific entity and optional page
   */
  async retrieveTechDocsContent(
    entityRef: string,
    pagePath?: string,
    auth?: any,
    catalog?: CatalogService,
  ): Promise<TechDocsContentResult | null> {
    try {
      // Parse entity reference (format: kind:namespace/name)
      const [kind, namespaceAndName] = entityRef.split(':');
      const [namespace = 'default', name] = namespaceAndName?.split('/') || [];

      if (!kind || !name) {
        throw new Error(
          `Invalid entity reference format: ${entityRef}. Expected format: kind:namespace/name`,
        );
      }

      // Get the entity from catalog if catalog service is provided
      let entity: Entity | undefined;
      if (catalog && auth) {
        const credentials = await auth.getOwnServiceCredentials();
        const entityResponse = await catalog.getEntityByRef(
          { kind, namespace, name },
          { credentials },
        );
        entity = entityResponse || undefined;
      }

      // Check if entity has TechDocs configured
      if (
        entity &&
        !entity.metadata?.annotations?.['backstage.io/techdocs-ref']
      ) {
        throw new Error(
          `Entity ${entityRef} does not have TechDocs configured`,
        );
      }

      // Default to index.html if no page path specified
      const targetPath = pagePath || 'index.html';

      this.logger.info(
        `Fetching TechDocs content for ${entityRef} at path: ${targetPath}`,
      );

      // Get the TechDocs backend URL
      const techdocsBaseUrl = await this.discovery.getBaseUrl('techdocs');
      const contentUrl = `${techdocsBaseUrl}/static/docs/${namespace}/${kind.toLowerCase()}/${name}/${targetPath}`;

      this.logger.debug(`Fetching content from URL: ${contentUrl}`);

      // Fetch the content via HTTP with authentication
      const fetch = this.fetchFunction || (await import('node-fetch')).default;

      // Try without authentication first (for cases where TechDocs allows public access)
      let response = await fetch(contentUrl);

      // If unauthorized, try with authentication
      if (response.status === 401) {
        const headers: Record<string, string> = {};

        // Try static token first
        const staticToken = this.getStaticToken();
        if (staticToken) {
          headers.Authorization = `Bearer ${staticToken}`;
        } else if (auth) {
          // Fallback to service credentials
          const credentials = await auth.getOwnServiceCredentials();
          if (credentials?.token) {
            headers.Authorization = `Bearer ${credentials.token}`;
          }
        }

        if (headers.Authorization) {
          response = await fetch(contentUrl, { headers });
        }
      }

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(
            `TechDocs content not found for ${entityRef} at path: ${targetPath}`,
          );
        }
        throw new Error(
          `Failed to fetch TechDocs content: ${response.status} ${response.statusText}`,
        );
      }

      const content = await response.text();

      // Fetch metadata for additional information
      const metadata = await this.fetchTechDocsMetadata(
        entity ||
          ({
            kind,
            metadata: { name, namespace },
          } as Entity),
      );

      // Determine content type based on file extension
      let contentType: 'markdown' | 'html' | 'text' = 'text';
      if (targetPath.endsWith('.md')) {
        contentType = 'markdown';
      } else if (targetPath.endsWith('.html') || targetPath.endsWith('.htm')) {
        contentType = 'html';
      }

      // Extract page title from HTML content if possible
      let pageTitle: string | undefined;
      if (contentType === 'html') {
        const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleMatch) {
          pageTitle = titleMatch[1].trim();
        }
      }

      return {
        entityRef,
        name,
        title: entity?.metadata?.title || name,
        kind,
        namespace,
        content,
        pageTitle,
        path: targetPath,
        contentType,
        lastModified: metadata?.build_timestamp
          ? new Date(metadata.build_timestamp * 1000).toISOString()
          : undefined,
        metadata: metadata
          ? {
              lastUpdated: metadata.build_timestamp
                ? new Date(metadata.build_timestamp * 1000).toISOString()
                : undefined,
              buildTimestamp: metadata.build_timestamp,
              siteName: metadata.site_name,
              siteDescription: metadata.site_description,
            }
          : undefined,
      };
    } catch (error) {
      this.logger.error(
        `Failed to retrieve TechDocs content for ${entityRef}: ${error}`,
      );
      throw error;
    }
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
  ): Promise<{ entities: TechDocsEntityWithMetadata[] }> {
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
        const techDocsMetadata = await this.fetchTechDocsMetadata(entity);

        const metadata = techDocsMetadata
          ? {
              lastUpdated: techDocsMetadata.build_timestamp
                ? new Date(
                    techDocsMetadata.build_timestamp * 1000,
                  ).toISOString()
                : undefined,
              buildTimestamp: techDocsMetadata.build_timestamp,
              siteName: techDocsMetadata.site_name,
              siteDescription: techDocsMetadata.site_description,
              etag: techDocsMetadata.etag,
              files: techDocsMetadata.files,
            }
          : undefined;

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
          metadata,
        };
      }),
    );

    this.logger.info(
      `Successfully found ${entities.length} entities with TechDocs`,
    );

    return { entities };
  }
}
