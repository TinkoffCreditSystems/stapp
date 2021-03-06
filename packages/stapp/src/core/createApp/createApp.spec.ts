import { compose, Middleware } from 'redux'
import { EMPTY, from, Observable, of, Subject } from 'rxjs'
import { filter, map } from 'rxjs/operators'
import {
  dangerouslyReplaceState,
  dangerouslyResetState
} from '../../events/dangerous'
import { disconnectEvent, readyEvent } from '../../events/lifecycle'
import { SOURCE } from '../../helpers/constants'
import { identity } from '../../helpers/identity/identity'
import { loggerModule } from '../../helpers/testHelpers/loggerModule/loggerModule'
import { createEvent } from '../createEvent/createEvent'
import { Event } from '../createEvent/createEvent.h'
import { createReducer } from '../createReducer/createReducer'
import { createApp } from './createApp'
import { Epic, Module, Thunk } from './createApp.h'
import { setObservableConfig } from './setObservableConfig'
import { createEpic } from '../createEpic/createEpic'
import { controlledPromise } from '../../helpers/controlledPromise/controlledPromise'

jest.useFakeTimers()

describe('createApp', () => {
  const mockReducer = createReducer({})
  const fire1 = createEvent('fire1')
  const fire2 = createEvent('fire2')
  const withSource = createEvent(
    'meta',
    () => undefined,
    (x: string[]) => ({
      [SOURCE]: x
    })
  )

  describe('lifecycle', () => {
    it('should create an app', () => {
      const m1 = {
        name: 'm1',
        reducers: { mockReducer }
      }

      const app = createApp({
        name: 'test',
        modules: [m1]
      })

      expect(app.api).toEqual({})
      expect(typeof app.subscribe).toBe('function')
    })

    it('should call module factory with passed extraArgument', () => {
      const module = jest.fn()
      module.mockReturnValue({
        name: 'test',
        reducers: { mockReducer }
      })

      const extraValue = { test: 123 }

      createApp({
        name: 'test',
        modules: [module],
        dependencies: extraValue
      })

      expect(module).toBeCalledWith(extraValue)
    })

    it('should disconnect reducers and subscribers', () => {
      const app = createApp({
        modules: [loggerModule({ pattern: null })]
      })

      const initialCalls = app.getState().eventLog.length

      app.dispatch(fire1())
      expect(app.getState().eventLog.length - initialCalls).toEqual(1)

      app.disconnect()
      expect(
        app.getState().eventLog[app.getState().eventLog.length - 1]
      ).toEqual(expect.objectContaining(disconnectEvent()))
      expect(app.getState().eventLog.length - initialCalls).toEqual(2)

      app.dispatch(fire1())
      expect(app.getState().eventLog.length - initialCalls).toEqual(2)
    })

    it('should unsubscribe from epics', () => {
      let eventStream: any
      const stream = new Subject()
      const epic: Epic<any> = (event$) => {
        eventStream = event$
        return stream
      }
      const module = {
        name: 't',
        epic
      }

      const app = createApp({
        modules: [module, loggerModule]
      })

      const observer = {
        next: jest.fn(),
        complete: jest.fn()
      }
      eventStream.subscribe(observer)

      stream.next(fire1())
      expect(observer.next).toBeCalledWith(expect.objectContaining(fire1()))
      expect(observer.next.mock.calls).toHaveLength(1)
      expect(app.getState().eventLog).toHaveLength(1)

      app.disconnect()
      expect(observer.next.mock.calls).toHaveLength(2)
      expect(observer.complete).toBeCalled()

      stream.next(fire1())
      expect(observer.next.mock.calls).toHaveLength(2)
      expect(app.getState().eventLog).toHaveLength(1)
    })
  })

  describe('checking dependencies', () => {
    it("should throw if passed module doesn't have a name", () => {
      const module = {}
      const moduleFactory = () => ({})

      expect(() => createApp({ modules: [module as any] })).toThrow()
      expect(() => createApp({ modules: [moduleFactory as any] })).toThrow()
    })

    it('should throw if two or more modules have same names', () => {
      const module = { name: 'test' }
      const moduleFactory = () => ({ name: 'test' })

      expect(() => createApp({ modules: [module, moduleFactory] })).toThrow()
    })

    it('should check dependencies', () => {
      const moduleA = {
        name: 'testA',
        reducers: { a: mockReducer },
        dependencies: ['testB']
      }

      const moduleB = {
        name: 'testB',
        reducers: { b: mockReducer },
        dependencies: ['testC']
      }

      const circular = {
        name: 'testC',
        reducers: { c: mockReducer },
        dependencies: ['testA', 'testB']
      }

      expect(() => createApp({ modules: [moduleA, moduleB] })).toThrow()
      expect(() =>
        createApp({ modules: [moduleA, moduleB, circular] })
      ).not.toThrow()
    })
  })

  describe('api', () => {
    it('should collect api from passed modules', () => {
      const m1 = {
        name: 'm1',
        events: {
          a1: createEvent()
        },
        reducers: { mockReducer }
      }

      const m2 = {
        name: 'm2',
        events: {
          a2: createEvent()
        }
      }

      const app = createApp({
        name: 'test',
        modules: [m1, m2]
      })

      expect(typeof app.api.a1).toBe('function')
      expect(typeof app.api.a2).toBe('function')
    })

    it('should support nested api', () => {
      const m1 = {
        name: 'm1',
        events: {
          a1: {
            a11: createEvent(),
            a12: createEvent()
          }
        },
        reducers: { mockReducer }
      }

      const m2 = {
        name: 'm2',
        events: {
          a2: createEvent()
        }
      }

      const app = createApp({
        name: 'test',
        modules: [m1, m2]
      })

      expect(typeof app.api.a1.a11).toBe('function')
      expect(typeof app.api.a1.a12).toBe('function')
      expect(typeof app.api.a2).toBe('function')
    })

    test('collected api should work', () => {
      const a1 = createEvent<number>()
      const r1 = createReducer(0).on(a1, (_, payload) => payload)
      const m1 = {
        name: 'm1',
        api: { a1 },
        state: { r1 }
      }

      const app = createApp({
        modules: [m1]
      })

      expect(app.getState().r1).toEqual(0)

      app.api.a1(1)
      expect(app.getState().r1).toEqual(1)
    })
  })

  describe('state', () => {
    it('should use rootReducer from passed modules', () => {
      const r1 = createReducer<{ called?: boolean }>({}).on(fire1, () => ({
        called: true
      }))
      const r2 = createReducer({}).on(fire2, () => ({ called: true }))

      const m1 = {
        name: 'm1',
        events: { fire1 },
        reducers: { r1 }
      }

      const m2 = {
        name: 'm2',
        events: { fire2 },
        reducers: { r2 }
      }

      const app = createApp({
        name: 'test',
        modules: [m1, m2]
      })

      let state: any
      app.subscribe((s) => (state = s))

      expect(state).toEqual({
        r1: {},
        r2: {}
      })

      app.api.fire1()

      expect(state).toEqual({
        r1: { called: true },
        r2: {}
      })

      app.api.fire2()

      expect(state).toEqual({
        r1: { called: true },
        r2: { called: true }
      })
    })

    it('should use rehydrate param of config to set initial state', () => {
      const m1 = {
        name: 'm1',
        reducers: { r1: mockReducer }
      }

      const app = createApp({
        name: 'test',
        modules: [m1],
        rehydrate: {
          r1: {
            test: 123
          }
        }
      })

      let state: any
      app.subscribe((s) => (state = s))

      expect(state).toEqual({
        r1: {
          test: 123
        }
      })
    })

    it('should react to special events', () => {
      const m1 = {
        name: 'm1',
        reducers: { r1: mockReducer }
      }

      const app = createApp({
        name: 'testApp',
        modules: [m1]
      })

      expect(app.getState()).toEqual({ r1: {} })

      app.dispatch(dangerouslyReplaceState({ r1: { test: 123 } }))
      expect(app.getState()).toEqual({ r1: { test: 123 } })

      app.dispatch(dangerouslyResetState())
      expect(app.getState()).toEqual({ r1: {} })
    })
  })

  describe('epics', () => {
    it('should provide epics a stream of events and a stream of state', () => {
      const events = jest.fn()
      const state = jest.fn()
      const m1: { epic: Epic<any>; name: string; state: any } = {
        name: 'm1',
        state: { m: mockReducer },
        epic: (event$, state$) => {
          expect(event$).toBeInstanceOf(Observable)
          expect(state$).toBeInstanceOf(Observable)

          event$.subscribe(events)
          state$.subscribe(state)

          return EMPTY
        }
      }

      const app = createApp({
        modules: [m1]
      })

      // Ignore initializing events
      const eventsInitialLength = events.mock.calls.length
      const stateInitialLength = state.mock.calls.length

      app.dispatch(fire1())
      expect(events.mock.calls).toHaveLength(1 + eventsInitialLength)
      expect(state.mock.calls).toHaveLength(1 + stateInitialLength)
      expect(events.mock.calls[events.mock.calls.length - 1][0]).toEqual(
        expect.objectContaining(fire1())
      )
      expect(state.mock.calls[state.mock.calls.length - 1][0]).toEqual(
        app.getState()
      )

      app.dispatch(fire2())
      expect(events.mock.calls).toHaveLength(2 + eventsInitialLength)
      expect(state.mock.calls).toHaveLength(2 + stateInitialLength)
      expect(events.mock.calls[events.mock.calls.length - 1][0]).toEqual(
        expect.objectContaining(fire2())
      )
      expect(state.mock.calls[state.mock.calls.length - 1][0]).toEqual(
        app.getState()
      )
    })

    it('should provide static api to epics', (done) => {
      expect.assertions(2)

      const m1: {
        epic: Epic<{ eventLog: Array<Event<any, any>> }>
        name: string
        state: any
      } = {
        name: 'm1',
        state: { m: mockReducer },
        epic: (_, __, { getState, dispatch }) => {
          expect(getState().eventLog).toEqual([])

          setTimeout(() => {
            dispatch(fire1())
            expect(getState().eventLog[0]).toEqual(
              expect.objectContaining(fire1())
            )
            done()
          }, 100)
        }
      }

      createApp({
        modules: [loggerModule, m1]
      })
      jest.runTimersToTime(100)
    })

    it('should use globalObservableConfig if defined', () => {
      const config = {
        fromESObservable: jest.fn(identity),
        toESObservable: jest.fn(identity)
      }
      setObservableConfig(config)

      let originalEventStream: any
      let originalStateStream: any
      const ret = EMPTY

      const m1 = {
        name: 'm1',
        state: { r: mockReducer },
        epic: () => ret
      }

      const m2 = {
        name: 'm2',
        epic: ((event$, state$) => {
          originalEventStream = event$
          originalStateStream = state$

          return EMPTY
        }) as Epic<any>,
        useGlobalObservableConfig: false
      }

      const app = createApp({
        modules: [m1, m2]
      })

      expect(config.toESObservable).toBeCalledWith(ret)
      expect(config.fromESObservable.mock.calls).toEqual([
        [originalEventStream],
        [originalStateStream]
      ])
    })

    it('should use local observable config by default', () => {
      const config = {
        fromESObservable: jest.fn(identity),
        toESObservable: jest.fn(identity)
      }

      let originalEventStream: any
      let originalStateStream: any
      const ret = EMPTY

      const m1 = {
        name: 'm1',
        state: { r: mockReducer },
        epic: () => ret,
        observableConfig: config
      }

      const m2 = {
        name: 'm2',
        epic: ((event$, state$) => {
          originalEventStream = event$
          originalStateStream = state$

          return EMPTY
        }) as Epic<any>,
        useGlobalObservableConfig: false
      }

      const app = createApp({
        modules: [m1, m2]
      })

      expect(config.toESObservable).toBeCalledWith(ret)
      expect(config.fromESObservable.mock.calls).toEqual([
        [originalEventStream],
        [originalStateStream]
      ])
    })

    it('should accept an array of epics', () => {
      expect.assertions(6)
      const m1: Module<any, any> = {
        name: 'm1',
        state: { m: mockReducer },
        epics: [
          (event$, state$) => {
            expect(event$).toBeInstanceOf(Observable)
            expect(state$).toBeInstanceOf(Observable)
          },
          (event$, state$) => {
            expect(event$).toBeInstanceOf(Observable)
            expect(state$).toBeInstanceOf(Observable)
          },
          (event$, state$) => {
            expect(event$).toBeInstanceOf(Observable)
            expect(state$).toBeInstanceOf(Observable)
          }
        ]
      }

      createApp({
        modules: [m1]
      })
    })
  })

  describe('dispatch', () => {
    it('should ignore empty dispatches', () => {
      const app = createApp({
        modules: [loggerModule]
      })

      app.dispatch(null)
      app.dispatch(undefined)

      expect(app.getState().eventLog).toEqual([])
    })

    it('should accept streams', async () => {
      const app = createApp({
        modules: [loggerModule]
      })

      await app.dispatch(of(fire1(), fire2()))

      expect(app.getState().eventLog).toEqual([
        expect.objectContaining(fire1()),
        expect.objectContaining(fire2())
      ])
    })

    it('should accept thunks', () => {
      expect.assertions(3)
      const app = createApp({
        modules: [loggerModule]
      })

      app.dispatch((getState: () => any, dispatch: any) => {
        expect(getState().eventLog).toEqual([])

        dispatch(fire1())
        expect(getState().eventLog).toEqual([expect.objectContaining(fire1())])

        dispatch(of(fire2()))
        expect(app.getState().eventLog).toEqual([
          expect.objectContaining(fire1()),
          expect.objectContaining(fire2())
        ])
      })
    })

    it('should ignore any other types', () => {
      const app = createApp({
        modules: [loggerModule]
      })

      app.dispatch({ test: '' })
      expect(app.getState().eventLog).toEqual([])
    })

    it('should add meta to every event coming from module', () => {
      const m1 = {
        name: 'm1',
        state: { r1: mockReducer },
        api: {
          a1: (): Thunk<any, any> => (_, dispatch) => {
            dispatch(fire1())
            dispatch(fire2())
          }
        }
      }

      const m2 = {
        name: 'm2',
        state: { r2: mockReducer },
        api: {
          a2: (): Thunk<any, any> => (_, dispatch) => {
            dispatch(fire1())
            dispatch(fire2())
          }
        }
      }

      const m3 = {
        name: 'm3',
        state: { r3: mockReducer },
        epic: () => {
          return of(fire1(), (_: any, dispatch: any) => {
            dispatch(fire2())
          })
        }
      }

      const app = createApp({
        name: 'test',
        modules: [m1, m2, m3, loggerModule]
      })

      const check = (o1: number, o2: number, name: string) => {
        expect(app.getState().eventLog[o1].type).toEqual(fire1.getType())
        expect(app.getState().eventLog[o1].meta[SOURCE]).toEqual([name])
        expect(app.getState().eventLog[o2].type).toEqual(fire2.getType())
        expect(app.getState().eventLog[o2].meta[SOURCE]).toEqual([name])
      }

      check(0, 1, m3.name)

      app.api.a1()
      check(2, 3, m1.name)

      app.api.a2()
      check(4, 5, m2.name)
    })

    it('should update meta', () => {
      let sent = false
      const m1 = {
        name: 'm1',
        state: { r1: mockReducer },
        epic: withSource.epic((withSource$) => {
          return withSource$.pipe(
            filter(() => !sent),
            map((x) => {
              sent = true
              return withSource((x.meta as any)[SOURCE])
            })
          )
        })
      }

      const app = createApp({
        modules: [m1, loggerModule]
      })

      app.dispatch(withSource(['test']))

      expect(app.getState().eventLog.map((x) => x.meta)).toEqual([
        { [SOURCE]: ['test', 'root'] },
        { [SOURCE]: ['test', 'root', m1.name] }
      ])
    })

    it('should queue events during initialization', () => {
      const mock = jest.fn()
      const m1 = {
        name: 'test1',
        state: { r1: mockReducer },
        epic: () => of(fire1())
      }

      const m2 = {
        name: 'test2',
        state: { r2: mockReducer },
        epic: fire1.epic((fire$) => {
          fire$.subscribe(mock)
        })
      }

      const app = createApp({
        name: 'testApp',
        modules: [m1, m2]
      })

      expect(mock).toBeCalledWith(expect.objectContaining(fire1()))
    })
  })

  describe('ready promise', () => {
    it('should be resolved by default', async () => {
      const app = createApp({
        modules: [loggerModule({ pattern: null })]
      })

      let resolved = false
      expect(app.getState().eventLog).toHaveLength(1)
      app.ready.then(() => (resolved = true))

      await null
      expect(resolved).toBe(true)

      await null
      expect(app.getState().eventLog).toHaveLength(2)

      expect(app.getState().eventLog[1]).toEqual(
        expect.objectContaining(readyEvent())
      )
    })

    it('should wait for events', async () => {
      const module = {
        name: 'test',
        waitFor: [fire1, fire2.getType()]
      }

      const app = createApp({
        modules: [loggerModule, module]
      })

      let resolved = false
      app.ready.then(() => (resolved = true))

      await null
      expect(resolved).toBe(false)

      app.dispatch(fire1())
      await null
      expect(resolved).toBe(false)

      app.dispatch(fire2())
      await null
      expect(resolved).toBe(true)
    })

    it('should accept object', async () => {
      const module = {
        name: 'test',
        waitFor: [
          {
            event: fire1
          }
        ]
      }

      const app = createApp({
        modules: [loggerModule, module]
      })

      let resolved = false
      app.ready.then(() => (resolved = true))

      await null
      expect(resolved).toBe(false)

      app.dispatch(fire1())
      await null
      expect(resolved).toBe(true)
    })

    it('should accept timeout', async () => {
      const module = {
        name: 'test',
        waitFor: [
          {
            event: fire1,
            timeout: 50
          }
        ]
      }

      const app = createApp({
        modules: [loggerModule, module]
      })

      let resolved = false
      app.ready.then(() => (resolved = true))

      await null
      expect(resolved).toBe(false)

      jest.runAllTimers()
      await null
      expect(resolved).toBe(true)
    })

    it('should accept condition', async () => {
      const module = {
        name: 'test',
        waitFor: [
          {
            event: fire1,
            condition() {
              return false
            }
          },
          {
            event: fire2,
            condition() {
              return true
            }
          }
        ]
      }

      const app = createApp({
        modules: [loggerModule, module]
      })

      let resolved = false
      app.ready.then(() => (resolved = true))

      await null
      expect(resolved).toBe(false)

      app.dispatch(fire2())
      await null
      expect(resolved).toBe(true)
    })
  })

  describe('app compatibility', () => {
    test('ES Observables compat test', () => {
      const app = createApp({
        name: 'testApp',
        modules: [loggerModule]
      })

      const stream = from(app)
      let state: any
      stream.subscribe((x) => (state = x))

      app.dispatch({ type: '1' })
      expect(state).toEqual(app.getState())

      app.dispatch({ type: '2' })
      expect(state).toEqual(app.getState())
    })
  })

  describe('Redux: devtools', () => {
    it('should use __REDUX_DEVTOOLS_EXTENSION_COMPOSE__ if available', () => {
      const rdec = jest.fn().mockImplementation(() => compose)
      ;(window as any).__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ = rdec

      const m1 = {
        name: 'm1',
        reducers: { mockReducer }
      }

      createApp({
        name: 'testApp',
        modules: [m1]
      })

      expect(rdec).toBeCalledWith({ name: 'testApp' })

      createApp({
        modules: [m1]
      } as any)

      expect(rdec.mock.calls[1][0]).toHaveProperty('name')
    })

    it('should disable devtools', () => {
      const rdec = jest.fn().mockImplementation(() => compose)
      ;(window as any).__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ = rdec

      const m1 = {
        name: 'm1',
        reducers: { mockReducer }
      }

      createApp({
        name: 'testApp',
        modules: [m1],
        devtools: false
      })

      expect(rdec).not.toBeCalled()
    })
    
    it('should disable devtools with config', () => {
      const rdec = jest.fn().mockImplementation(() => compose)
      ;(window as any).__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ = rdec

      const m1 = {
        name: 'm1',
        reducers: { mockReducer }
      }

      createApp({
        name: 'testApp',
        modules: [m1],
        devtools: { enableDevTools: () => false }
      })

      expect(rdec).not.toBeCalled()
    })

    it('should ignore devtools parameter if set to true', () => {
      const rdec = jest.fn().mockImplementation(() => compose)
      ;(window as any).__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ = rdec

      const m1 = {
        name: 'm1',
        reducers: { mockReducer }
      }

      createApp({
        name: 'testApp',
        modules: [m1],
        devtools: true as false
      })

      expect(rdec).toBeCalledWith({ name: 'testApp' })
    })

    it('should pass devtools config', () => {
      const rdec = jest.fn().mockImplementation(() => compose)
      ;(window as any).__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ = rdec

      const m1 = {
        name: 'm1',
        reducers: { mockReducer }
      }

      createApp({
        name: 'testApp',
        modules: [m1],
        devtools: {
          maxAge: 1
        }
      })

      expect(rdec).toBeCalledWith({ name: 'testApp', maxAge: 1 })
    })

    it('should overwrite name', () => {
      const rdec = jest.fn().mockImplementation(() => compose)
      ;(window as any).__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ = rdec

      const m1 = {
        name: 'm1',
        reducers: { mockReducer }
      }

      createApp({
        name: 'testApp',
        modules: [m1],
        devtools: {
          name: 'test'
        }
      })

      expect(rdec).toBeCalledWith({ name: 'test' })
    })
  })

  test('Redux: custom middleware support', () => {
    let mock: any
    const middleware: Middleware = () => (next) => {
      mock = jest.fn((action: any) => {
        return next(action)
      })

      return mock
    }

    const m1 = {
      name: 'm1',
      reducers: { mockReducer }
    }

    createApp({
      name: 'testApp',
      modules: [m1],
      middlewares: [middleware]
    })

    expect(mock).toBeDefined()
    expect(mock).toBeCalled()
  })

  test('Tests: handle async errors', async () => {
    const failEvent = createEvent<any>()
    const failingEpic: Epic<any> = createEpic(failEvent, (event$) => {
      return event$.pipe(
        map(({ payload }) => {
          throw payload
        })
      )
    })

    const [promise, resolve] = controlledPromise()

    const handleEpicsErrors = jest.fn(resolve)

    const app = createApp({
      modules: [
        {
          name: 'Failing module',
          epic: failingEpic
        },
        loggerModule
      ],
      handleEpicsErrors
    })

    expect(handleEpicsErrors).not.toBeCalled()

    app.dispatch(failEvent(1))

    await promise

    expect(handleEpicsErrors).toBeCalledWith(1)
  })
})
