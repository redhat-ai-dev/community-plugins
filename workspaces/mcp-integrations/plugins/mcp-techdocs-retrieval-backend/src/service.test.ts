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
import { ConfigReader } from '@backstage/config';
import { TechDocsService } from './service';
import { Entity } from '@backstage/catalog-model';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import { LoggerService, DiscoveryService } from '@backstage/backend-plugin-api';
import { TechDocsMetadata } from '@backstage/plugin-techdocs-node';

describe('TechDocsService', () => {
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as LoggerService;

  const mockDiscovery = {
    getBaseUrl: jest.fn().mockResolvedValue('http://localhost:7007/api'),
  } as unknown as DiscoveryService;

  const mockConfig = new ConfigReader({
    app: {
      baseUrl: 'http://localhost:3000',
    },
  });

  const mockAuth = {
    getOwnServiceCredentials: jest.fn().mockResolvedValue({
      principal: { subject: 'user:default/test' },
    }),
  };

  const createMockEntity = (
    name: string,
    kind: string = 'Component',
    hasTechDocs: boolean = false,
    options: Partial<Entity> = {},
  ): Entity => ({
    apiVersion: 'backstage.io/v1alpha1',
    kind,
    metadata: {
      name,
      namespace: 'default',
      title: `${name} title`,
      description: `${name} description`,
      tags: ['test', 'mock'],
      annotations: hasTechDocs ? { 'backstage.io/techdocs-ref': 'dir:.' } : {},
      ...options.metadata,
    },
    spec: {
      type: 'service',
      owner: 'team-test',
      lifecycle: 'production',
      ...options.spec,
    },
  });

  const mockPublisher = {
    fetchTechDocsMetadata: jest.fn(),
  };

  let service: TechDocsService;

  beforeEach(() => {
    service = new TechDocsService(mockConfig, mockLogger, mockDiscovery);
    // Mock the publisher
    jest.spyOn(service, 'getPublisher').mockResolvedValue(mockPublisher as any);
    jest.clearAllMocks();
  });

  describe('generateTechDocsUrls', () => {
    it('should generate correct URLs for an entity', async () => {
      const entity = createMockEntity('test-service');
      const urls = await service.generateTechDocsUrls(entity);

      expect(urls).toEqual({
        techDocsUrl:
          'http://localhost:3000/docs/default/component/test-service',
        metadataUrl:
          'http://localhost:7007/api/entities/by-name/component/default/test-service',
      });
    });

    it('should handle different entity kinds', async () => {
      const entity = createMockEntity('test-api', 'API');
      const urls = await service.generateTechDocsUrls(entity);

      expect(urls).toEqual({
        techDocsUrl: 'http://localhost:3000/docs/default/api/test-api',
        metadataUrl:
          'http://localhost:7007/api/entities/by-name/api/default/test-api',
      });
    });

    it('should handle different namespaces', async () => {
      const entity = createMockEntity('test-service', 'Component', false, {
        metadata: { name: 'test-service', namespace: 'production' },
      });
      const urls = await service.generateTechDocsUrls(entity);

      expect(urls).toEqual({
        techDocsUrl:
          'http://localhost:3000/docs/production/component/test-service',
        metadataUrl:
          'http://localhost:7007/api/entities/by-name/component/production/test-service',
      });
    });
  });

  describe('fetchTechDocsMetadata', () => {
    it('should fetch metadata for an entity successfully', async () => {
      const entity = createMockEntity('test-service');
      const mockMetadata: TechDocsMetadata = {
        site_name: 'Test Service Docs',
        site_description: 'Documentation for test service',
        etag: 'abc123',
        build_timestamp: 1609459200,
        files: ['index.html', 'api.html'],
      };

      mockPublisher.fetchTechDocsMetadata.mockResolvedValue(mockMetadata);

      const result = await service.fetchTechDocsMetadata(entity);

      expect(result).toEqual(mockMetadata);
      expect(mockPublisher.fetchTechDocsMetadata).toHaveBeenCalledWith({
        kind: 'component',
        namespace: 'default',
        name: 'test-service',
      });
    });

    it('should handle errors gracefully and return null', async () => {
      const entity = createMockEntity('test-service');
      mockPublisher.fetchTechDocsMetadata.mockRejectedValue(
        new Error('Metadata not found'),
      );

      const result = await service.fetchTechDocsMetadata(entity);

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to fetch TechDocs metadata for Component:default/test-service',
        expect.any(Error),
      );
    });

    it('should handle different entity kinds and namespaces', async () => {
      const entity = createMockEntity('test-api', 'API', false, {
        metadata: { name: 'test-api', namespace: 'production' },
      });
      const mockMetadata: TechDocsMetadata = {
        site_name: 'Test API Docs',
        site_description: 'API documentation',
        etag: 'xyz789',
        build_timestamp: 1609459200,
      };

      mockPublisher.fetchTechDocsMetadata.mockResolvedValue(mockMetadata);

      const result = await service.fetchTechDocsMetadata(entity);

      expect(result).toEqual(mockMetadata);
      expect(mockPublisher.fetchTechDocsMetadata).toHaveBeenCalledWith({
        kind: 'api',
        namespace: 'production',
        name: 'test-api',
      });
    });
  });

  describe('listTechDocs', () => {
    it('should return entities with TechDocs annotation', async () => {
      const entitiesWithDocs = [
        createMockEntity('service-1', 'Component', true),
        createMockEntity('api-1', 'API', true),
      ];
      const entitiesWithoutDocs = [
        createMockEntity('service-2', 'Component', false),
      ];

      const mockCatalog = catalogServiceMock({
        entities: [...entitiesWithDocs, ...entitiesWithoutDocs],
      });

      // Mock metadata responses
      mockPublisher.fetchTechDocsMetadata.mockResolvedValue(null);

      const result = await service.listTechDocs({}, mockAuth, mockCatalog);

      expect(result.entities).toHaveLength(2);
      expect(result.entities.map(e => e.name)).toContain('service-1');
      expect(result.entities.map(e => e.name)).toContain('api-1');
      expect(result.entities.map(e => e.name)).not.toContain('service-2');
    });

    it('should include URLs and metadata in the response', async () => {
      const entityWithDocs = createMockEntity(
        'service-with-docs',
        'Component',
        true,
      );
      const mockMetadata: TechDocsMetadata = {
        site_name: 'Service with Docs',
        site_description: 'Documentation for service with docs',
        etag: 'abc123',
        build_timestamp: 1609459200,
        files: ['index.html'],
      };

      const mockCatalog = catalogServiceMock({
        entities: [entityWithDocs],
      });

      mockPublisher.fetchTechDocsMetadata.mockResolvedValue(mockMetadata);

      const result = await service.listTechDocs({}, mockAuth, mockCatalog);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0]).toEqual({
        name: 'service-with-docs',
        title: 'service-with-docs title',
        tags: ['test', 'mock'],
        description: 'service-with-docs description',
        owner: 'team-test',
        lifecycle: 'production',
        namespace: 'default',
        kind: 'Component',
        techDocsUrl:
          'http://localhost:3000/docs/default/component/service-with-docs',
        metadataUrl:
          'http://localhost:7007/api/entities/by-name/component/default/service-with-docs',
        metadata: {
          lastUpdated: '2021-01-01T00:00:00.000Z',
          buildTimestamp: 1609459200,
          siteName: 'Service with Docs',
          siteDescription: 'Documentation for service with docs',
          etag: 'abc123',
          files: ['index.html'],
        },
      });
    });

    it('should handle entities without metadata gracefully', async () => {
      const entityWithDocs = createMockEntity(
        'service-without-metadata',
        'Component',
        true,
      );
      const mockCatalog = catalogServiceMock({
        entities: [entityWithDocs],
      });

      mockPublisher.fetchTechDocsMetadata.mockResolvedValue(null);

      const result = await service.listTechDocs({}, mockAuth, mockCatalog);

      expect(result.entities).toHaveLength(1);
      expect(result.entities[0]).toEqual({
        name: 'service-without-metadata',
        title: 'service-without-metadata title',
        tags: ['test', 'mock'],
        description: 'service-without-metadata description',
        owner: 'team-test',
        lifecycle: 'production',
        namespace: 'default',
        kind: 'Component',
        techDocsUrl:
          'http://localhost:3000/docs/default/component/service-without-metadata',
        metadataUrl:
          'http://localhost:7007/api/entities/by-name/component/default/service-without-metadata',
        metadata: undefined,
      });
    });

    it('should handle empty catalog', async () => {
      const mockCatalog = catalogServiceMock({ entities: [] });
      mockPublisher.fetchTechDocsMetadata.mockResolvedValue(null);

      const result = await service.listTechDocs({}, mockAuth, mockCatalog);

      expect(result.entities).toHaveLength(0);
    });

    it('should filter by entity type', async () => {
      const entities = [
        createMockEntity('component-1', 'Component', true),
        createMockEntity('api-1', 'API', true),
        createMockEntity('system-1', 'System', true),
      ];

      const mockCatalog = catalogServiceMock({ entities });
      jest.spyOn(mockCatalog, 'getEntities');
      mockPublisher.fetchTechDocsMetadata.mockResolvedValue(null);

      await service.listTechDocs(
        { entityType: 'Component' },
        mockAuth,
        mockCatalog,
      );

      expect(mockCatalog.getEntities).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { kind: 'Component' },
        }),
        expect.any(Object),
      );
    });

    it('should filter by namespace', async () => {
      const entities = [
        createMockEntity('service-1', 'Component', true, {
          metadata: { name: 'service-1', namespace: 'production' },
        }),
        createMockEntity('service-2', 'Component', true, {
          metadata: { name: 'service-2', namespace: 'staging' },
        }),
      ];

      const mockCatalog = catalogServiceMock({ entities });
      jest.spyOn(mockCatalog, 'getEntities');
      mockPublisher.fetchTechDocsMetadata.mockResolvedValue(null);

      await service.listTechDocs(
        { namespace: 'production' },
        mockAuth,
        mockCatalog,
      );

      expect(mockCatalog.getEntities).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { 'metadata.namespace': 'production' },
        }),
        expect.any(Object),
      );
    });

    it('should filter by owner', async () => {
      const entities = [
        createMockEntity('service-1', 'Component', true, {
          spec: { owner: 'team-a' },
        }),
        createMockEntity('service-2', 'Component', true, {
          spec: { owner: 'team-b' },
        }),
      ];

      const mockCatalog = catalogServiceMock({ entities });
      jest.spyOn(mockCatalog, 'getEntities');
      mockPublisher.fetchTechDocsMetadata.mockResolvedValue(null);

      await service.listTechDocs({ owner: 'team-a' }, mockAuth, mockCatalog);

      expect(mockCatalog.getEntities).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { 'spec.owner': 'team-a' },
        }),
        expect.any(Object),
      );
    });

    it('should filter by lifecycle', async () => {
      const entities = [
        createMockEntity('service-1', 'Component', true, {
          spec: { lifecycle: 'production' },
        }),
        createMockEntity('service-2', 'Component', true, {
          spec: { lifecycle: 'experimental' },
        }),
      ];

      const mockCatalog = catalogServiceMock({ entities });
      jest.spyOn(mockCatalog, 'getEntities');
      mockPublisher.fetchTechDocsMetadata.mockResolvedValue(null);

      await service.listTechDocs(
        { lifecycle: 'production' },
        mockAuth,
        mockCatalog,
      );

      expect(mockCatalog.getEntities).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { 'spec.lifecycle': 'production' },
        }),
        expect.any(Object),
      );
    });

    it('should filter by tags', async () => {
      const entities = [
        createMockEntity('service-1', 'Component', true, {
          metadata: { name: 'service-1', tags: ['frontend', 'react'] },
        }),
        createMockEntity('service-2', 'Component', true, {
          metadata: { name: 'service-2', tags: ['backend', 'node'] },
        }),
      ];

      const mockCatalog = catalogServiceMock({ entities });
      jest.spyOn(mockCatalog, 'getEntities');
      mockPublisher.fetchTechDocsMetadata.mockResolvedValue(null);

      await service.listTechDocs({ tags: ['frontend'] }, mockAuth, mockCatalog);

      expect(mockCatalog.getEntities).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: { 'metadata.tags': ['frontend'] },
        }),
        expect.any(Object),
      );
    });

    it('should handle multiple filters', async () => {
      const entities = [
        createMockEntity('service-1', 'Component', true, {
          metadata: { name: 'service-1', namespace: 'production' },
          spec: { owner: 'team-a', lifecycle: 'production' },
        }),
      ];

      const mockCatalog = catalogServiceMock({ entities });
      jest.spyOn(mockCatalog, 'getEntities');
      mockPublisher.fetchTechDocsMetadata.mockResolvedValue(null);

      await service.listTechDocs(
        {
          entityType: 'Component',
          namespace: 'production',
          owner: 'team-a',
          lifecycle: 'production',
        },
        mockAuth,
        mockCatalog,
      );

      expect(mockCatalog.getEntities).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: {
            kind: 'Component',
            'metadata.namespace': 'production',
            'spec.owner': 'team-a',
            'spec.lifecycle': 'production',
          },
        }),
        expect.any(Object),
      );
    });

    it('should respect limit option', async () => {
      const entities = [createMockEntity('service-1', 'Component', true)];
      const mockCatalog = catalogServiceMock({ entities });
      jest.spyOn(mockCatalog, 'getEntities');
      mockPublisher.fetchTechDocsMetadata.mockResolvedValue(null);

      await service.listTechDocs({ limit: 100 }, mockAuth, mockCatalog);

      expect(mockCatalog.getEntities).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 100,
        }),
        expect.any(Object),
      );
    });

    it('should use default limit when not specified', async () => {
      const entities = [createMockEntity('service-1', 'Component', true)];
      const mockCatalog = catalogServiceMock({ entities });
      jest.spyOn(mockCatalog, 'getEntities');
      mockPublisher.fetchTechDocsMetadata.mockResolvedValue(null);

      await service.listTechDocs({}, mockAuth, mockCatalog);

      expect(mockCatalog.getEntities).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 500,
        }),
        expect.any(Object),
      );
    });
  });

  describe('analyzeCoverage', () => {
    it('should calculate correct coverage percentage', async () => {
      const entities = [
        createMockEntity('service-1', 'Component', true),
        createMockEntity('service-2', 'Component', false),
        createMockEntity('service-3', 'Component', true),
        createMockEntity('service-4', 'Component', false),
      ];

      const mockCatalog = catalogServiceMock({ entities });

      const result = await service.analyzeCoverage({}, mockAuth, mockCatalog);

      expect(result).toEqual({
        totalEntities: 4,
        entitiesWithDocs: 2,
        coveragePercentage: 50.0,
      });
    });

    it('should handle 100% coverage', async () => {
      const entities = [
        createMockEntity('service-1', 'Component', true),
        createMockEntity('service-2', 'Component', true),
      ];

      const mockCatalog = catalogServiceMock({ entities });

      const result = await service.analyzeCoverage({}, mockAuth, mockCatalog);

      expect(result).toEqual({
        totalEntities: 2,
        entitiesWithDocs: 2,
        coveragePercentage: 100.0,
      });
    });

    it('should handle 0% coverage', async () => {
      const entities = [
        createMockEntity('service-1', 'Component', false),
        createMockEntity('service-2', 'Component', false),
      ];

      const mockCatalog = catalogServiceMock({ entities });

      const result = await service.analyzeCoverage({}, mockAuth, mockCatalog);

      expect(result).toEqual({
        totalEntities: 2,
        entitiesWithDocs: 0,
        coveragePercentage: 0.0,
      });
    });

    it('should handle empty catalog', async () => {
      const mockCatalog = catalogServiceMock({ entities: [] });

      const result = await service.analyzeCoverage({}, mockAuth, mockCatalog);

      expect(result).toEqual({
        totalEntities: 0,
        entitiesWithDocs: 0,
        coveragePercentage: 0,
      });
    });

    it('should round coverage percentage to 1 decimal place', async () => {
      const entities = [
        createMockEntity('service-1', 'Component', true),
        createMockEntity('service-2', 'Component', false),
        createMockEntity('service-3', 'Component', false),
      ];

      const mockCatalog = catalogServiceMock({ entities });

      const result = await service.analyzeCoverage({}, mockAuth, mockCatalog);

      expect(result.coveragePercentage).toBe(33.3);
    });

    it('should apply filters correctly', async () => {
      const entities = [
        createMockEntity('component-1', 'Component', true, {
          metadata: { name: 'component-1', namespace: 'production' },
          spec: { owner: 'team-a', lifecycle: 'production' },
        }),
        createMockEntity('component-2', 'Component', false, {
          metadata: { name: 'component-2', namespace: 'production' },
          spec: { owner: 'team-a', lifecycle: 'production' },
        }),
        createMockEntity('api-1', 'API', true, {
          metadata: { name: 'api-1', namespace: 'staging' },
          spec: { owner: 'team-b', lifecycle: 'experimental' },
        }),
      ];

      const mockCatalog = catalogServiceMock({ entities });
      jest.spyOn(mockCatalog, 'getEntities');

      await service.analyzeCoverage(
        {
          entityType: 'Component',
          namespace: 'production',
        },
        mockAuth,
        mockCatalog,
      );

      expect(mockCatalog.getEntities).toHaveBeenCalledWith(
        expect.objectContaining({
          filter: {
            kind: 'Component',
            'metadata.namespace': 'production',
          },
        }),
        expect.any(Object),
      );
    });

    it('should log coverage analysis results', async () => {
      const entities = [
        createMockEntity('service-1', 'Component', true),
        createMockEntity('service-2', 'Component', false),
      ];

      const mockCatalog = catalogServiceMock({ entities });

      await service.analyzeCoverage({}, mockAuth, mockCatalog);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'Analyzing TechDocs coverage...',
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Coverage analysis complete: 1/2 entities (50.0%) have TechDocs',
      );
    });
  });

  describe('error handling', () => {
    it('should handle catalog service errors in listTechDocs', async () => {
      const mockCatalog = {
        getEntities: jest
          .fn()
          .mockRejectedValue(new Error('Catalog service error')),
      };

      await expect(
        service.listTechDocs({}, mockAuth, mockCatalog as any),
      ).rejects.toThrow('Catalog service error');
    });

    it('should handle catalog service errors in analyzeCoverage', async () => {
      const mockCatalog = {
        getEntities: jest
          .fn()
          .mockRejectedValue(new Error('Catalog service error')),
      };

      await expect(
        service.analyzeCoverage({}, mockAuth, mockCatalog as any),
      ).rejects.toThrow('Catalog service error');
    });
  });

  describe('initialization', () => {
    it('should initialize publisher when getPublisher is called', async () => {
      const publisher = await service.getPublisher();
      expect(publisher).toBeDefined();
    });

    it('should reuse initialized publisher on subsequent calls', async () => {
      const publisher1 = await service.getPublisher();
      const publisher2 = await service.getPublisher();
      expect(publisher1).toBe(publisher2);
    });
  });
});
