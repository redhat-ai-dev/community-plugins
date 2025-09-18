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
import {
  coreServices,
  createBackendPlugin,
} from '@backstage/backend-plugin-api';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { actionsRegistryServiceRef } from '@backstage/backend-plugin-api/alpha';
import { TechDocsService } from './service';

export const mcpTechdocsRetrievalPlugin = createBackendPlugin({
  pluginId: 'mcp-techdocs-retrieval',
  register(env) {
    env.registerInit({
      deps: {
        actionsRegistry: actionsRegistryServiceRef,
        logger: coreServices.logger,
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        catalog: catalogServiceRef,
        auth: coreServices.auth,
        config: coreServices.rootConfig,
        discovery: coreServices.discovery,
      },
      // Sample action used in the Backstage docs: https://github.com/backstage/backstage/tree/master/plugins/mcp-actions-backend
      async init({
        actionsRegistry,
        catalog,
        auth,
        logger,
        config,
        discovery,
      }) {
        // This action is used to  entities from Backstage. It returns an array of entity names
        actionsRegistry.register({
          name: 'fetch-techdocs',
          title: 'Ftech TechDocs Entities',
          description: ` Search and retrieve all Techdoc entities from the Backstage Server

      List all Backstage TechDoc entities. Results are returned in JSON array format, where each
      entry includes entity details and TechDocs metadata like last update timestamp and build information.

      Example invocations and the output from those invocations:
        Output: {
          "entities": [
            {
              "name": "developer-model-service",
              "title": "Developer Model Service",
              "tags": [
                "genai",
                "ibm-granite"
              ],
              "description": "A description",
              "owner": "user:default/exampleuser",
              "lifecycle": "experimental",
              "namespace": "default",
              "kind": "Component",
              "techDocsUrl": "https://backstage.example.com/docs/default/component/developer-model-service",
              "metadataUrl": "https://backstage.example.com/api/techdocs/default/component/developer-model-service",
              "metadata": {
                "lastUpdated": "2024-01-15T10:30:00Z",
                "buildTimestamp": 1705313400,
                "siteName": "Developer Model Service Docs",
                "siteDescription": "Documentation for the developer model service"
              }
            }
          ]
        }
      }
`,
          schema: {
            input: z =>
              z.object({
                entityType: z
                  .string()
                  .optional()
                  .describe(
                    'Filter by entity type (e.g., Component, API, System)',
                  ),
                namespace: z
                  .string()
                  .optional()
                  .describe('Filter by namespace'),
                owner: z
                  .string()
                  .optional()
                  .describe(
                    'Filter by owner (e.g., team-platform, user:john.doe)',
                  ),
                lifecycle: z
                  .string()
                  .optional()
                  .describe(
                    'Filter by lifecycle (e.g., production, staging, development)',
                  ),
                tags: z
                  .array(z.string())
                  .optional()
                  .describe(
                    'Filter by tags (e.g., ["genai", "frontend", "api"])',
                  ),
              }),
            output: z =>
              z.object({
                entities: z
                  .array(
                    z.object({
                      name: z
                        .string()
                        .describe(
                          'The name field for each techdoc in the backstage server',
                        ),
                      title: z
                        .string()
                        .describe(
                          'The title field for each techdoc in the backstage server',
                        ),
                      tags: z
                        .array(z.string())
                        .describe(
                          'The tags associated with the techdoc entity',
                        ),
                      description: z
                        .string()
                        .describe('The description of the techdoc entity'),
                      owner: z
                        .string()
                        .describe(
                          'The owner of the techdoc entity (e.g., team-platform, user:john.doe)',
                        ),
                      lifecycle: z
                        .string()
                        .describe(
                          'The lifecycle of the techdoc entity (e.g., production, staging, development)',
                        ),
                      namespace: z
                        .string()
                        .describe('The namespace of the techdoc entity'),
                      kind: z
                        .string()
                        .describe(
                          'The kind of the techdoc entity (e.g., Component, API, System)',
                        ),
                      techDocsUrl: z
                        .string()
                        .describe(
                          'Direct URL to the TechDocs site for this entity',
                        ),
                      metadataUrl: z
                        .string()
                        .describe(
                          'API URL to access TechDocs metadata for this entity',
                        ),
                      metadata: z
                        .object({
                          lastUpdated: z
                            .string()
                            .optional()
                            .describe(
                              'ISO timestamp of when the TechDocs were last updated',
                            ),
                          buildTimestamp: z
                            .number()
                            .optional()
                            .describe(
                              'Unix timestamp of when the TechDocs were built',
                            ),
                          siteName: z
                            .string()
                            .optional()
                            .describe('Name of the TechDocs site'),
                          siteDescription: z
                            .string()
                            .optional()
                            .describe('Description of the TechDocs site'),
                          etag: z
                            .string()
                            .optional()
                            .describe('ETag for caching purposes'),
                          files: z
                            .array(z.string())
                            .optional()
                            .describe('List of files in the TechDocs site'),
                        })
                        .optional()
                        .describe('TechDocs metadata information'),
                    }),
                  )
                  .describe('List of entities with TechDocs'),
              }),
          },
          action: async ({ input }) => {
            try {
              const techDocsService = new TechDocsService(
                config,
                logger,
                discovery,
              );
              const result = await techDocsService.listTechDocs(
                input,
                auth,
                catalog,
              );
              return {
                output: {
                  ...result,
                },
              };
            } catch (error) {
              logger.error(
                'fetch-catalog-entities: Error fetching catalog entities:',
                error,
              );
              return {
                output: {
                  entities: [],
                },
              };
            }
          },
        });

        // Register coverage analysis action
        actionsRegistry.register({
          name: 'analyze-techdocs-coverage',
          title: 'Analyze TechDocs Coverage',
          description: `Analyze documentation coverage across Backstage entities to understand what percentage of entities have TechDocs available.

      This tool provides platform engineers with visibility into documentation coverage across their software ecosystem. It calculates the percentage of entities that have TechDocs configured, helping identify documentation gaps and improve overall documentation coverage.

      Example output:
      {
        "totalEntities": 150,
        "entitiesWithDocs": 95,
        "coveragePercentage": 63.3
      }

      Supports filtering by entity type, namespace, owner, lifecycle, and tags to analyze coverage for specific subsets of entities.`,
          schema: {
            input: z =>
              z.object({
                entityType: z
                  .string()
                  .optional()
                  .describe(
                    'Filter by entity type (e.g., Component, API, System)',
                  ),
                namespace: z
                  .string()
                  .optional()
                  .describe('Filter by namespace'),
                owner: z
                  .string()
                  .optional()
                  .describe(
                    'Filter by owner (e.g., team-platform, user:john.doe)',
                  ),
                lifecycle: z
                  .string()
                  .optional()
                  .describe(
                    'Filter by lifecycle (e.g., production, staging, development)',
                  ),
                tags: z
                  .array(z.string())
                  .optional()
                  .describe(
                    'Filter by tags (e.g., ["genai", "frontend", "api"])',
                  ),
              }),
            output: z =>
              z.object({
                totalEntities: z
                  .number()
                  .describe('Total number of entities in the filtered set'),
                entitiesWithDocs: z
                  .number()
                  .describe('Number of entities that have TechDocs configured'),
                coveragePercentage: z
                  .number()
                  .describe('Percentage of entities with TechDocs (0-100)'),
              }),
          },
          action: async ({ input }) => {
            try {
              const techDocsService = new TechDocsService(
                config,
                logger,
                discovery,
              );
              const result = await techDocsService.analyzeCoverage(
                input,
                auth,
                catalog,
              );
              return {
                output: result,
              };
            } catch (error) {
              logger.error(
                'analyze-techdocs-coverage: Error analyzing coverage:',
                error,
              );
              return {
                output: {
                  totalEntities: 0,
                  entitiesWithDocs: 0,
                  coveragePercentage: 0,
                },
              };
            }
          },
        });
      },
    });
  },
});
