import type { GatewayResponse, RouteDefinition, RouteHandler, RequestContext } from '../models/interfaces.js';
import { ApiError, ErrorCode } from '../models/errors.js';

/**
 * Result of a route match attempt.
 */
export interface RouteMatch {
  route: RouteDefinition;
  pathParams: Record<string, string>;
}

/**
 * Convert a route path pattern (e.g. "/jobs/{id}") into a RegExp and
 * extract the parameter names.
 */
function compileRoutePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];

  // Escape special regex chars except for our {param} placeholders
  const regexStr = pattern
    .split('/')
    .map((segment) => {
      const paramMatch = segment.match(/^\{(\w+)\}$/);
      if (paramMatch) {
        paramNames.push(paramMatch[1]);
        // Match one or more non-slash characters
        return '([^/]+)';
      }
      // Escape any regex-special characters in literal segments
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');

  return {
    regex: new RegExp(`^${regexStr}$`),
    paramNames,
  };
}

/**
 * Internal compiled route used for efficient matching.
 */
interface CompiledRoute {
  definition: RouteDefinition;
  regex: RegExp;
  paramNames: string[];
}

/**
 * Router that registers route definitions and matches incoming requests
 * by HTTP method and path, including path parameters.
 */
export class Router {
  private routes: CompiledRoute[] = [];

  /**
   * Register a single route definition.
   */
  register(route: RouteDefinition): void {
    const { regex, paramNames } = compileRoutePattern(route.path);
    this.routes.push({ definition: route, regex, paramNames });
  }

  /**
   * Register multiple route definitions at once.
   */
  registerAll(routes: RouteDefinition[]): void {
    for (const route of routes) {
      this.register(route);
    }
  }

  /**
   * Attempt to match a request method and path against registered routes.
   * Returns the matching route and extracted path parameters, or null if
   * no route matches.
   */
  match(method: string, path: string): RouteMatch | null {
    const upperMethod = method.toUpperCase();

    for (const compiled of this.routes) {
      if (compiled.definition.method.toUpperCase() !== upperMethod) {
        continue;
      }

      const match = compiled.regex.exec(path);
      if (match) {
        const pathParams: Record<string, string> = {};
        for (let i = 0; i < compiled.paramNames.length; i++) {
          pathParams[compiled.paramNames[i]] = match[i + 1];
        }
        return { route: compiled.definition, pathParams };
      }
    }

    return null;
  }

  /**
   * Dispatch a request to the matching route handler.
   * Returns the handler response on match, or a 404 GatewayResponse if
   * no route matches.
   */
  async dispatch(context: RequestContext, correlationId: string): Promise<GatewayResponse> {
    const routeMatch = this.match(context.httpMethod, context.path);

    if (!routeMatch) {
      const error = new ApiError(
        ErrorCode.NOT_FOUND,
        `No route found for ${context.httpMethod} ${context.path}`,
        404,
        correlationId,
      );
      return error.toResponse();
    }

    return routeMatch.route.handler(context);
  }
}
