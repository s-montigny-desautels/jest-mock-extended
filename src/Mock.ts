import calledWithFn from './CalledWithFn';
import { MatchersOrLiterals } from './Matchers';
import { DeepPartial, Primitive } from 'ts-essentials';

type ProxiedProperty = string | number | symbol;

export interface GlobalConfig {
    // ignoreProps is required when we don't want to return anything for a mock (for example, when mocking a promise).
    ignoreProps?: ProxiedProperty[];
}

const DEFAULT_CONFIG: GlobalConfig = {
    ignoreProps: ['then']
};

let GLOBAL_CONFIG = DEFAULT_CONFIG;

export const JestMockExtended = {
    DEFAULT_CONFIG,
    configure: (config: GlobalConfig) => {
        // Shallow merge so they can override anything they want.
        GLOBAL_CONFIG = { ...DEFAULT_CONFIG, ...config };
    }
};

export interface CalledWithMock<T, Y extends any[]> extends jest.Mock<T, Y> {
    calledWith: (...args: Y | MatchersOrLiterals<Y>) => jest.Mock<T, Y>;
}

export type MockProxy<T> = {
    // This supports deep mocks in the else branch
    [K in keyof T]: T[K] extends (...args: infer A) => infer B ? CalledWithMock<B, A> : MockProxy<T[K]>;
} &
    T;

export interface MockOpts {
    deep?: boolean;
}

export const mockClear = (mock: MockProxy<any>) => {
    _queryMockPrimitive = true;
    for (let key of Object.keys(mock)) {
        if (mock[key]._isMockObject) {
            mockClear(mock[key]);
        }
        console.log(mock[key]);
        if (mock[key]._isMockFunction) {
            mock[key].mockClear();
        }
    }
    _queryMockPrimitive = false;

    // This is a catch for if they pass in a jest.fn()
    if (!mock._isMockObject) {
        return mock.mockClear();
    }
};

export const mockReset = (mock: MockProxy<any>) => {
    _queryMockPrimitive = true;
    for (let key of Object.keys(mock)) {
        if (mock[key]._isMockObject) {
            mockReset(mock[key]);
        }
        if (mock[key]._isMockFunction) {
            mock[key].mockReset();
        }
    }
    _queryMockPrimitive = false;

    // This is a catch for if they pass in a jest.fn()
    // Worst case, we will create a jest.fn() (since this is a proxy)
    // below in the get and call mockReset on it
    if (!mock._isMockObject) {
        return mock.mockReset();
    }
};

export const mockDeep = <T>(mockImplementation?: DeepPartial<T>): MockProxy<T> & T => mock(mockImplementation, { deep: true });

const overrideMockImp = (obj: DeepPartial<any>, opts?: MockOpts) => {
    initMockObject(obj);

    const proxy = new Proxy<MockProxy<any>>(obj, handler(opts));
    for (let name of Object.keys(obj)) {
        if (typeof obj[name] === 'object' && obj[name] !== null) {
            proxy[name] = overrideMockImp(obj[name], opts);
        } else {
            proxy[name] = obj[name];
        }
    }

    return proxy;
};

const initMockObject = (obj: DeepPartial<any>) => {
    obj._isMockObject = true;
    obj._isMockPrimitive = false;
};

const isMockPrimitive = (obj: any) => {
    return !_queryMockPrimitive && !!obj && obj._isMockPrimitive;
};

const handler = (opts?: MockOpts) => ({
    ownKeys(target: MockProxy<any>) {
        return Reflect.ownKeys(target);
    },

    set: (obj: MockProxy<any>, property: ProxiedProperty, value: any) => {
        // @ts-ignore All of these ignores are due to https://github.com/microsoft/TypeScript/issues/1863
        obj[property] = value;
        return true;
    },

    get: (obj: MockProxy<any>, property: ProxiedProperty) => {
        let fn = calledWithFn();

        // @ts-ignore
        if (!(property in obj)) {
            if (GLOBAL_CONFIG.ignoreProps?.includes(property)) {
                return undefined;
            }
            // Jest's internal equality checking does some wierd stuff to check for iterable equality
            if (property === Symbol.iterator) {
                // @ts-ignore
                return obj[property];
            }
            // So this calls check here is totally not ideal - jest internally does a
            // check to see if this is a spy - which we want to say no to, but blindly returning
            // an proxy for calls results in the spy check returning true. This is another reason
            // why deep is opt in.
            if (opts?.deep && property !== 'calls') {
                // @ts-ignore
                const fn = calledWithFn();
                initMockObject(fn);
                obj[property] = new Proxy<MockProxy<any>>(fn, handler(opts));
            } else {
                // @ts-ignore
                obj[property] = calledWithFn();
            }
        }

        // @ts-ignore
        const value = obj[property];

        if (isMockPrimitive(value)) {
            return value();
        }
        return value;
    }
});

let _queryMockPrimitive = false;

type PrimitiveMock<T> = jest.Mock<T, any> & T;
export const mockPrimitive = <T extends Primitive>(getter?: () => T): PrimitiveMock<T> => {
    let primitiveMock: PrimitiveMock<T> | undefined = undefined;
    if (getter) {
        _queryMockPrimitive = true;
        primitiveMock = getter() as PrimitiveMock<T>;
        _queryMockPrimitive = false;
    }
    if (!primitiveMock) {
        primitiveMock = jest.fn() as PrimitiveMock<T>;
    }

    // @ts-ignore private
    primitiveMock._isMockPrimitive = true;

    return primitiveMock;
};

const mock = <T>(mockImplementation: DeepPartial<T> = {} as DeepPartial<T>, opts?: MockOpts): MockProxy<T> & T => {
    return overrideMockImp(mockImplementation, opts);
};

export const mockFn = <
    T extends Function,
    A extends any[] = T extends (...args: infer AReal) => any ? AReal : any[],
    R = T extends (...args: any) => infer RReal ? RReal : any
>(): CalledWithMock<R, A> & T => {
    // @ts-ignore
    return calledWithFn();
};

export default mock;
