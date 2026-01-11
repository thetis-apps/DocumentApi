/**
 * Copyright 2021 Thetis Apps Aps
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * 
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * 
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
 
const axios = require('axios');

let cachedIms = null;

async function getIMS() {

    if (cachedIms != null) {
        return cachedIms;
    }

    const authUrl = "https://auth.thetis-ims.com/oauth2/";
    const apiUrl = "https://api.thetis-ims.com/2/";

	let clientId = process.env.ClientId;
	let clientSecret = process.env.ClientSecret;  
	let apiKey = process.env.ApiKey;  

    console.log(clientId + " - " + clientSecret);
    
    console.log(apiKey);

    let credentials = clientId + ":" + clientSecret;
	let base64data = Buffer.from(credentials, 'UTF-8').toString('base64');	
	
	let imsAuth = axios.create({
			baseURL: authUrl,
			headers: { Authorization: "Basic " + base64data, 'Content-Type': "application/x-www-form-urlencoded" },
			responseType: 'json'
		});

    let response = await imsAuth.post("token", 'grant_type=client_credentials');
    let token = response.data.token_type + " " + response.data.access_token;
    
    let ims = axios.create({
    		baseURL: apiUrl,
    		headers: { "Authorization": token, "x-api-key": apiKey, "Content-Type": "application/json" }
    	});
	
	ims.interceptors.response.use(function (response) {
			console.log("SUCCESS " + JSON.stringify(response.data));
 	    	return response;
		}, function (error) {
			if (error.response) {
				console.log("FAILURE " + error.response.status + " - " + JSON.stringify(error.response.data));
			}
	    	return Promise.reject(error);
		});

    cachedIms = ims;

    return ims;
}

async function extendReplenishmentList(ims, document) {
    let response = await ims.get('documents/' + document.id + '/globalTradeItemsToReplenish');
    let gtis = response.data;
    for (let gti of gtis) {
        gti.replenishFromLots = JSON.parse(gti.replenishFromLots);
        for (let lot of gti.replenishFromLots) {
            lot.lost = false;
            lot.numItemsReplenished = 0;
        }
        gti.logisticVariants = JSON.parse(gti.logisticVariants);
    }
    document.globalTradeItemsToReplenish = gtis;
}

async function extendPurchaseProposal(ims, document) {
    let response = await ims.get('documents/' + document.id + '/globalTradeItemsToOrder');
    document.globalTradeItemsToOrder = response.data;
}

async function extendPutAwayList(ims, document) {
    let response = await ims.get('documents/' + document.id + '/globalTradeItemLotsToPutAway');
    document.globalTradeItemLotsToPutAway = response.data;
}

async function extendMultiPickingList(ims, document) {
    let response = await ims.get('documents/' + document.id + '/shipmentLinesToPack');
    let lines = response.data;
    for (let line of lines) {
        if (line.pickFromLots != null) {
            line.pickFromLots = JSON.parse(line.pickFromLots);
        } else {
            line.pickFromLots = [];
        }
    }
    document.shipmentLinesToPack = lines;
    
}

async function extendStockTakingList(ims, document) {
    let response = await ims.get('documents/' + document.id + '/stockTakingLinesToDo');
    document.stockTakingLinesToDo = response.data;
}

async function getPendingDocuments(ims, documentType, maxNumRows, extender) {
    let documentFilter = new Object();
    documentFilter.documentType = documentType;
    documentFilter.workStatus = 'PENDING';
    documentFilter.maxNumRows = maxNumRows;
    documentFilter.onlyNotCancelled = true;
    let response = await ims.get('documents', { params: documentFilter });
    
    let documents = response.data;
    for (let i = 0; i < documents.length; i++) {
        let document = documents[i];
        await extender(ims, document);            
    }

    response = {
            'statusCode': 200,
            'body': JSON.stringify(documents),
            'headers': {
                'Access-Control-Allow-Origin': '*'
            }
        };

    return response;

}

exports.pick = async (event, context) => {
    const ims = await getIMS();
    const response = await ims.post('invocations/pick', event.body, { validateStatus: function (status) {
            return status >= 200 && status < 300 || status === 422; // default
        }});
    return {
        'statusCode': response.status,
        'body': JSON.stringify(response.data),
        'headers': {
            'Access-Control-Allow-Origin': '*'
        }
    };

}


exports.getPendingMultiPickingLists = async (event, context) => {
    try {
        
        let ims = await getIMS();

        return await getPendingDocuments(ims, 'MULTI_PICKING_LIST', 10, extendMultiPickingList);            

    } catch (err) {
        return errorResponse(err);
    }

};

exports.getPendingPutAwayLists = async (event, context) => {
    try {
        
        let ims = await getIMS();

        return await getPendingDocuments(ims, 'PUT_AWAY_LIST', 10, extendPutAwayList);
        
    } catch (err) {
        return errorResponse(err);
    }

};

exports.getPendingReplenishmentLists = async (event, context) => {
    try {
        
        let ims = await getIMS();

        return await getPendingDocuments(ims, 'REPLENISHMENT_LIST', 10, extendReplenishmentList);
        
    } catch (err) {
        return errorResponse(err);
    }

};

exports.getPendingStockTakingLists = async (event, context) => {
    try {
        
        let ims = await getIMS();

        return await getPendingDocuments(ims, 'STOCK_TAKING_LIST', 10, extendStockTakingList);
        
    } catch (err) {
        return errorResponse(err);
    }

};

async function putDocumentWorkStatus(ims, document, extender) {

    let workStatus = document.workStatus;
    
    let response = await ims.patch('/documents/' + document.id, { workStatus: workStatus }, { validateStatus: function (status) {
		    return status >= 200 && status < 300 || status == 422; // default
		}});
		
	let body;
    if (response.status == 422) {
        body = response.data;
    } else {
        body = response.data;
        await extender(ims, body);
    }
    
    response = {
            'statusCode': response.status,
            'body': JSON.stringify(body),
            'headers': {
                'Access-Control-Allow-Origin': '*'
            }
        };
            
    return response;

}

function errorResponse(error) {
    let response = {
            'statusCode': 500,
            'body': JSON.stringify(error),
            'headers': {
                'Access-Control-Allow-Origin': '*'
            }
        };
    return response;
}

exports.putMultiPickingList = async (event, context) => {
    
    try {
        
        let ims = await getIMS();
        
        const documentId = event.pathParameters.id;
        
        let multiPickingList = JSON.parse(event.body);
        
        return await putDocumentWorkStatus(ims, multiPickingList, extendMultiPickingList);
        
    } catch (err) {
        return errorResponse(err);
    }
    
};

exports.putPutAwayList = async (event, context) => {
    
    try {
        
        let ims = await getIMS();
        
        let putAwayList = JSON.parse(event.body);

        let lots = putAwayList.globalTradeItemLotsToPutAway;
        for (let lot of lots) {
            if (lot.done) {
                let params = new Object();
                params.globalTradeItemLotId = lot.id;
                params.locationNumber = lot.globalTradeItemLocationNumber;
                params.numItems = lot.numItemsRemaining;
                let response = await ims.post('invocations/putAway', params, { validateStatus: function (status) {
        			    return status >= 200 && status < 300 || status == 422; 
        			}});

                if (response.status == 422) {
                    let message = new Object();
            		message.time = Date.now();
            		message.source = "DocumentApi";
            		message.messageType = response.data.messageType;
            		message.messageText = 'Failed to put away. Reason: ' + response.data.messageText;
            		await ims.post("events/" + putAwayList.documentCreatedEventId + "/messages", message);
                }
            }
        }

        return await putDocumentWorkStatus(ims, putAwayList, extendPutAwayList);

    } catch (err) {
        return errorResponse(err);
    }
    
};

exports.putReplenishmentList = async (event, context) => {
    
    try {
        
        let ims = await getIMS();
        
        let replenishmentList = JSON.parse(event.body);
        
        let lines = replenishmentList.globalTradeItemsToReplenish;
        for (let line of lines) {
            
            let lots = line.replenishFromLots;
            for (let lot of lots) {
                
                if (lot.numItemsReplenished > 0) {
                    
                    let params = new Object();
                    params.globalTradeItemId = line.id;
                    params.replenishFromLotId = lot.id;
                    params.numItems = lot.numItemsReplenished;
                    let response = await ims.post('invocations/replenish', params, { validateStatus: function (status) {
            			    return status >= 200 && status < 300 || status == 422; 
            			}});

                    if (response.status == 422) {
                        let message = new Object();
                		message.time = Date.now();
                		message.source = "DocumentApi";
                		message.messageType = response.data.messageType;
                		message.messageText = 'Failed to replenish. Reason: ' + response.data.messageText;
                		await ims.post("events/" + replenishmentList.documentCreatedEventId + "/messages", message);
                    }

                }
            }
        }
        
        return await putDocumentWorkStatus(ims, replenishmentList, extendReplenishmentList);
    
    } catch (err) {
        return errorResponse(err);
    }
    
};

exports.putStockTakingList = async (event, context) => {
    
    try {
        
        let ims = await getIMS();
        
        let stockTakingList = JSON.parse(event.body);
        
        let lines = stockTakingList.stockTakingLinesToDo;
        for (let line of lines) {
            if (line.counted) {
                await ims.patch('stockTakingLines/' + line.id, { counted: true, numItemsCounted: line.numItemsCounted });
            }
        }

        return await putDocumentWorkStatus(ims, stockTakingList, extendStockTakingList);
    
    } catch (err) {
        return errorResponse(err);
    }
    
};
