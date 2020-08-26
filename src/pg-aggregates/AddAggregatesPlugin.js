"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const AddAggregatesPlugin = builder => {
    // Hook all connections to add the 'aggregates' field
    builder.hook("GraphQLObjectType:fields", (fields, build, context) => {
        const { newWithHooks, graphql: { GraphQLObjectType }, inflection, getSafeAliasFromResolveInfo, pgSql: sql, getSafeAliasFromAlias, pgQueryFromResolveData: queryFromResolveData, } = build;
        const { fieldWithHooks, scope: { isPgRowConnectionType, pgIntrospection: table }, } = context;
        // If it's not a table connection, abort
        if (!isPgRowConnectionType ||
            !table ||
            table.kind !== "class" ||
            !table.namespace) {
            return fields;
        }
        const AggregateType = newWithHooks(GraphQLObjectType, {
            name: inflection.aggregateType(table),
        }, {
            isPgAggregateType: true,
            pgIntrospection: table,
        }, true);
        if (!AggregateType) {
            // No aggregates for this connection, abort
            return fields;
        }
        const fieldName = inflection.aggregatesField(table);
        return Object.assign({}, fields, { [fieldName]: fieldWithHooks(fieldName, ({ addDataGenerator, getDataFromParsedResolveInfoFragment }) => {
                addDataGenerator((parsedResolveInfoFragment) => {
                    const safeAlias = getSafeAliasFromAlias(parsedResolveInfoFragment.alias);
                    const resolveData = getDataFromParsedResolveInfoFragment(parsedResolveInfoFragment, AggregateType);
                    return {
                        // This tells the query planner that we want to add an aggregate
                        pgAggregateQuery: (aggregateQueryBuilder) => {
                            aggregateQueryBuilder.select(() => {
                                const query = queryFromResolveData(sql.identifier(Symbol()), aggregateQueryBuilder.getTableAlias(), // Keep using our alias down the tree
                                resolveData, { onlyJsonField: true }, (innerQueryBuilder) => {
                                    innerQueryBuilder.parentQueryBuilder = aggregateQueryBuilder;
                                }, aggregateQueryBuilder.context);
                                return sql.fragment `(${query})`;
                            }, safeAlias);
                        },
                    };
                });
                return {
                    description: `Aggregates across the matching connection (ignoring before/after/first/last/offset)`,
                    type: AggregateType,
                    resolve(parent, _args, _context, resolveInfo) {
                        // Figure out the unique alias we chose earlier
                        const safeAlias = getSafeAliasFromResolveInfo(resolveInfo);
                        // All aggregates are stored into the 'aggregates' object, reference ours here
                        return parent.aggregates[safeAlias] || 0;
                    },
                };
            }, {}) });
    });
    // Hook the '*Aggregates' type for each table to add the "sum" operation
    builder.hook("GraphQLObjectType:fields", (fields, build, context) => {
        const { pgField, inflection, newWithHooks, graphql: { GraphQLObjectType }, getSafeAliasFromResolveInfo, } = build;
        const { fieldWithHooks, scope: { isPgAggregateType, pgIntrospection: table }, } = context;
        if (!isPgAggregateType) {
            return fields;
        }
        const AggregateSumType = newWithHooks(GraphQLObjectType, {
            name: inflection.aggregateSumType(table),
        }, {
            isPgSumAggregateType: true,
            pgIntrospection: table,
        }, true);
        if (!AggregateSumType) {
            // No sum aggregates for this connection, abort
            return fields;
        }
        const fieldName = inflection.aggregatesSumField(table);
        return Object.assign({}, fields, { [fieldName]: pgField(build, fieldWithHooks, fieldName, {
                description: `Sum aggregates across the matching connection (ignoring before/after/first/last/offset)`,
                type: AggregateSumType,
                resolve(parent, _args, _context, resolveInfo) {
                    const safeAlias = getSafeAliasFromResolveInfo(resolveInfo);
                    return parent[safeAlias];
                },
            }, {} // scope,
            ) });
    });
    // Hook the sum aggregates type to add fields for each numeric table column
    builder.hook("GraphQLObjectType:fields", (fields, build, context) => {
        const { pgSql: sql, graphql: { GraphQLNonNull, GraphQLFloat }, inflection, getSafeAliasFromAlias, getSafeAliasFromResolveInfo, pgField, } = build;
        const { fieldWithHooks, scope: { isPgSumAggregateType, pgIntrospection: table }, } = context;
        if (!isPgSumAggregateType || !table || table.kind !== "class") {
            return fields;
        }
        return Object.assign({}, fields, table.attributes.reduce((memo, attr) => {
            // Didn't use 'numeric' here because it'd be confusing with the 'NUMERIC' type.
            const attrIsNumberLike = attr.type.category === "N";
            if (attrIsNumberLike) {
                const fieldName = inflection.column(attr);
                return build.extend(memo, {
                    [fieldName]: pgField(build, fieldWithHooks, fieldName, ({ addDataGenerator }) => {
                        addDataGenerator((parsedResolveInfoFragment) => {
                            return {
                                pgQuery: (queryBuilder) => {
                                    // Note this expression is just an sql fragment, so you
                                    // could add CASE statements, function calls, or whatever
                                    // you need here
                                    const expr = sql.fragment `${queryBuilder.getTableAlias()}.${sql.identifier(attr.name)}`;
                                    queryBuilder.select(
                                    // You can put any aggregate expression here; I've wrapped it in `coalesce` so that it cannot be null
                                    sql.fragment `coalesce(sum(${expr}), 0)`, 
                                    // We need a unique alias that we can later reference in the resolver
                                    getSafeAliasFromAlias(parsedResolveInfoFragment.alias));
                                },
                            };
                        });
                        return {
                            description: `Sum of ${fieldName} across the matching connection`,
                            type: new GraphQLNonNull(GraphQLFloat),
                            resolve(parent, _args, _context, resolveInfo) {
                                const safeAlias = getSafeAliasFromResolveInfo(resolveInfo);
                                return parent[safeAlias];
                            },
                        };
                    }, {
                        // In case anyone wants to hook us, describe ourselves
                        isPgConnectionSumField: true,
                        pgFieldIntrospection: attr,
                    }),
                });
            }
            return memo;
        }, {}));
    });
};
exports.default = AddAggregatesPlugin;
//# sourceMappingURL=AddAggregatesPlugin.js.map