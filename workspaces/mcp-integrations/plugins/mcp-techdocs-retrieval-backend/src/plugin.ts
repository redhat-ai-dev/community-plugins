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
      
      List all Backstage TechDoc entities such. By default, results are returned in JSON array format, where each
      entry in the JSON array is an entity with the following fields: 'name', 'description', 'type', 'owner', 'tags',
      'dependsOn' and 'kind'. Setting 'verbose' to true will return the full Backstage entity objects, but should
      only be used if the reduced output is not sufficient, as this will significantly impact context usage (especially
      on smaller models). Note: 'type' can only be filtered on if a specified entity 'kind' is also specified.
      
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
              "metadataUrl": "https://backstage.example.com/api/techdocs/default/component/developer-model-service"
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
      },
    });
  },
});
