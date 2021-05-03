import { Cipher } from '../models/domain/cipher';
import { CipherView } from '../models/view/cipherView';

import { ContainerService } from '../services/container.service';
import { CryptoService } from '../services/crypto.service';
import { MemoryStorageService } from '../services/memoryStorage.service';
import { WebCryptoFunctionService } from '../services/webCryptoFunction.service';
import { WorkerLogService } from '../services/workerLogService';

const workerApi: Worker = self as any;
let firstRun = true;

workerApi.addEventListener('message', async event => {
    if (event.data.type !== 'decryptManyRequest' || !firstRun) {
        return;
    }
    firstRun = false;
    const decryptAllWorker = new CryptoWorker(event.data, workerApi);
    await decryptAllWorker.decryptMany();
});

class CryptoWorker {
    data: any;
    workerApi: Worker;
    encryptedCiphers: Cipher[];

    containerService: ContainerService;
    cryptoFunctionService: WebCryptoFunctionService;
    cryptoService: CryptoService;
    logService: WorkerLogService;
    platformUtilsService: any;
    secureStorageService: MemoryStorageService;
    storageService: MemoryStorageService;

    constructor(data: any, worker: Worker) {
        this.data = data;
        this.workerApi = worker;
        this.startServices();
        this.listen();

        this.encryptedCiphers = JSON.parse(this.data.ciphers).map((c: any) => new Cipher(c));

        const storage = JSON.parse(data.storage);
        if (storage != null) {
            for (const prop in storage) {
                if (!storage.hasOwnProperty(prop)) {
                    continue;
                }
                this.storageService.save(prop, storage[prop]);
            }
        }

        const secureStorage = JSON.parse(data.secureStorage);
        if (secureStorage != null) {
            for (const prop in secureStorage) {
                if (!secureStorage.hasOwnProperty(prop)) {
                    continue;
                }
                this.secureStorageService.save(prop, secureStorage[prop]);
            }
        }
    }

    startServices() {
        if (this.data.platformUtilsData != null) {
            const platformUtilsData = JSON.parse(this.data.platformUtilsData);
            this.platformUtilsService = {
                isIE: () => platformUtilsData.isIE,
                isSafari: () => platformUtilsData.isSafari,
            };
        }

        this.cryptoFunctionService = new WebCryptoFunctionService(self, this.platformUtilsService);
        this.logService = new WorkerLogService(false);
        this.secureStorageService = new MemoryStorageService();
        this.storageService = new MemoryStorageService();

        this.cryptoService = new CryptoService(this.storageService, this.secureStorageService, this.cryptoFunctionService,
            this.platformUtilsService, this.logService);

        this.containerService = new ContainerService(this.cryptoService);
        this.containerService.attachToGlobal(self);
    }

    async decryptMany() {
        const promises: any[] = [];
        const decryptedCiphers: CipherView[] = [];

        this.encryptedCiphers.forEach(cipher => {
            promises.push(cipher.decrypt().then(c => decryptedCiphers.push(c)));
        });
        await Promise.all(promises);

        const response = decryptedCiphers.map(c => JSON.stringify(c));

        this.postMessage({ type: 'decryptManyResponse', ciphers: response });

        this.clearCache();
    }

    postMessage(message: any) {
        workerApi.postMessage(message);
    }

    async clearCache() {
        await Promise.all([
            this.cryptoService.clearKey(),
            this.cryptoService.clearOrgKeys(false),
            this.cryptoService.clearKeyPair(false),
            this.cryptoService.clearEncKey(false),
        ]);
    }

    listen() {
        workerApi.addEventListener('message', async event => {
            switch (event.data?.type) {
                case 'clearCacheRequest':
                    await this.clearCache();
                    this.postMessage({ type: 'clearCacheResponse' });
                    break;
                default:
                    break;
            }
        });
    }
}
