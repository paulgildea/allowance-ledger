@description('Environment name used for resource naming.')
param environmentName string

@description('Azure region for resources.')
param location string = resourceGroup().location

@description('Container name that stores ledger json.')
param ledgerContainerName string = 'ledger'

@description('Weekly credit amount for each child.')
param weeklyCreditAmount string = '5'

var resourceToken = toLower(uniqueString(subscription().subscriptionId, resourceGroup().id, environmentName))
var storageName = 'st${resourceToken}'
var staticWebAppName = 'swa-${environmentName}-${substring(resourceToken, 0, 6)}'
var staticWebAppLocation = 'eastus2'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  name: '${storage.name}/default'
}

resource ledgerContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  name: '${storage.name}/default/${ledgerContainerName}'
  properties: {
    publicAccess: 'None'
  }
  dependsOn: [
    blobService
  ]
}

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: staticWebAppName
  location: staticWebAppLocation
  tags: {
    'azd-service-name': 'web'
  }
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {}
}

resource staticWebAppSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  name: 'appsettings'
  parent: staticWebApp
  properties: {
    AzureWebJobsStorage: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};AccountKey=${listKeys(storage.id, storage.apiVersion).keys[0].value};EndpointSuffix=${environment().suffixes.storage}'
    LEDGER_CONTAINER: ledgerContainerName
    WEEKLY_CREDIT_AMOUNT: weeklyCreditAmount
  }
  dependsOn: [
    ledgerContainer
  ]
}

output staticWebAppUrl string = 'https://${staticWebApp.properties.defaultHostname}'
output functionApiBaseUrl string = 'https://${staticWebApp.properties.defaultHostname}/api'
output storageAccountName string = storage.name
