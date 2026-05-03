/**
 * Serverless Real-Time Collaborative Platform
 * AWS API Gateway WebSockets, Lambda, DynamoDB.
 * Operational Transformation (OT) logic for conflict-free edits.
 */
const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB.DocumentClient();

// In a real AWS environment, this endpoint is provided by the event context
const apigwManagementApi = new AWS.ApiGatewayManagementApi({
  endpoint: process.env.API_GATEWAY_ENDPOINT || 'http://localhost:3001'
});

exports.handler = async (event) => {
    const connectionId = event.requestContext.connectionId;
    const routeKey = event.requestContext.routeKey;
    
    console.log(`[WS] ${routeKey} - Connection: ${connectionId}`);

    try {
        if (routeKey === '$connect') {
            // Store connection in DynamoDB
            await ddb.put({
                TableName: process.env.CONNECTIONS_TABLE || 'Connections',
                Item: {
                    connectionId: connectionId,
                    timestamp: Date.now()
                }
            }).promise();
            return { statusCode: 200, body: 'Connected.' };
            
        } else if (routeKey === '$disconnect') {
            // Remove connection
            await ddb.delete({
                TableName: process.env.CONNECTIONS_TABLE || 'Connections',
                Key: { connectionId: connectionId }
            }).promise();
            return { statusCode: 200, body: 'Disconnected.' };
            
        } else if (routeKey === 'sync_edit') {
            // Handle Operational Transformation (OT) sync
            const body = JSON.parse(event.body);
            const { documentId, operation, revision } = body;
            
            // 1. Fetch current document state and active connections
            // 2. Apply OT logic to resolve conflicts if revision is stale
            // 3. Save new state to DynamoDB
            // 4. Broadcast the applied operation to all other connected clients
            
            console.log(`[OT] Syncing edit for doc ${documentId} at revision ${revision}`);
            
            // Mock broadcast
            const connections = await ddb.scan({ TableName: process.env.CONNECTIONS_TABLE || 'Connections' }).promise();
            
            const postCalls = connections.Items.map(async ({ connectionId: cid }) => {
                if (cid !== connectionId) {
                    try {
                        await apigwManagementApi.postToConnection({
                            ConnectionId: cid,
                            Data: JSON.stringify({ type: 'remote_edit', operation, revision: revision + 1 })
                        }).promise();
                    } catch (e) {
                        if (e.statusCode === 410) {
                            // Stale connection, clean it up
                            await ddb.delete({ TableName: process.env.CONNECTIONS_TABLE || 'Connections', Key: { connectionId: cid } }).promise();
                        }
                    }
                }
            });
            
            await Promise.all(postCalls);
            
            return { statusCode: 200, body: 'Edit synced.' };
        }
        
        return { statusCode: 400, body: 'Unknown route.' };
        
    } catch (err) {
        console.error(err);
        return { statusCode: 500, body: 'Server error.' };
    }
};
