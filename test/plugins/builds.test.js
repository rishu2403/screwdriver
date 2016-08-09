'use strict';
const assert = require('chai').assert;
const sinon = require('sinon');
const hapi = require('hapi');
const mockery = require('mockery');
const urlLib = require('url');

const testBuild = require('./data/build.json');
const testBuilds = require('./data/builds.json');

sinon.assert.expose(assert, { prefix: '' });

/**
 * Stub for BuildModel factory method
 * @method buildModelFactoryMock
 */
function buildModelFactoryMock() {}

/**
 * Stub for JobModel factory method
 * @method jobModelFactoryMock
 */
function jobModelFactoryMock() {}

/**
 * Stub for PipelineModel factory method
 * @method pipelineModelFactoryMock
 */
function pipelineModelFactoryMock() {}

/**
 * Stub for UserModel factory method
 * @method userModelFactoryMock
 */
function userModelFactoryMock() {}

describe('build plugin test', () => {
    let jobMock;
    let pipelineMock;
    let userMock;
    let buildMock;
    let executorOptions;
    let plugin;
    let server;

    before(() => {
        mockery.enable({
            useCleanCache: true,
            warnOnUnregistered: false
        });
    });

    beforeEach((done) => {
        executorOptions = sinon.stub();
        jobMock = {
            get: sinon.stub()
        };
        pipelineMock = {
            get: sinon.stub()
        };
        userMock = {
            getPermissions: sinon.stub()
        };
        buildMock = {
            create: sinon.stub(),
            stream: sinon.stub(),
            get: sinon.stub(),
            list: sinon.stub(),
            update: sinon.stub()
        };
        buildModelFactoryMock.prototype = buildMock;
        jobModelFactoryMock.prototype = jobMock;
        pipelineModelFactoryMock.prototype = pipelineMock;
        userModelFactoryMock.prototype = userMock;

        mockery.registerMock('./credentials', {
            generateProfile: (username, scope) => ({ username, scope }),
            generateToken: (profile, token) => JSON.stringify(profile) + JSON.stringify(token)
        });
        mockery.registerMock('screwdriver-models', {
            Build: buildModelFactoryMock,
            Pipeline: pipelineModelFactoryMock,
            User: userModelFactoryMock,
            Job: jobModelFactoryMock
        });

        /* eslint-disable global-require */
        plugin = require('../../plugins/builds');
        /* eslint-enable global-require */
        server = new hapi.Server({
            app: {
                datastore: buildMock,
                executor: executorOptions
            }
        });
        server.connection({
            port: 12345,
            host: 'localhost'
        });

        server.register([{
            // eslint-disable-next-line global-require
            register: require('../../plugins/login'),
            options: {
                password: 'this_is_a_password_that_needs_to_be_atleast_32_characters',
                oauthClientId: '1234id5678',
                oauthClientSecret: '1234secretoauthything5678',
                jwtPrivateKey: '1234secretkeythatissupersecret5678',
                https: true
            }
        }, {
            register: plugin,
            options: { password: 'thispasswordismine' }
        }], (err) => {
            done(err);
        });
    });

    afterEach(() => {
        server = null;
        mockery.deregisterAll();
        mockery.resetCache();
    });

    after(() => {
        mockery.disable();
    });

    it('registers the plugin', () => {
        assert.isOk(server.registrations.builds);
    });

    describe('GET /builds', () => {
        it('returns 200 and all builds', (done) => {
            buildMock.list.yieldsAsync(null, testBuilds);
            server.inject('/builds?page=1&count=2', (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testBuilds);
                assert.calledWith(buildMock.list, {
                    paginate: {
                        page: 1,
                        count: 2
                    }
                });
                done();
            });
        });
    });

    describe('GET /builds/{id}/logs', () => {
        const buildId = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const options = {
            url: `/builds/${buildId}/logs`,
            credentials: {
                scope: ['user']
            }
        };

        it('returns error when Build.get returns error', (done) => {
            const err = new Error('getError');

            buildMock.get.withArgs(buildId).yieldsAsync(err);
            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                assert.notCalled(buildMock.stream);
                done();
            });
        });

        it('returns 404 when build does not exist', (done) => {
            buildMock.get.withArgs(buildId).yieldsAsync(null, null);
            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                assert.notCalled(buildMock.stream);
                done();
            });
        });

        it('returns error when Build.stream returns error', (done) => {
            const err = new Error('getError');

            buildMock.get.withArgs(buildId).yieldsAsync(null, testBuild);
            buildMock.stream.yieldsAsync(err);
            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                assert.calledWith(buildMock.stream, {
                    buildId
                });
                done();
            });
        });

        it('calls the build stream with the right values', (done) => {
            buildMock.get.withArgs(buildId).yieldsAsync(null, testBuild);
            buildMock.stream.yieldsAsync(null, {});
            server.inject({
                url: `/builds/${buildId}/logs`,
                credentials: {
                    scope: ['user']
                }
            }, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, {});
                assert.calledWith(buildMock.stream, {
                    buildId
                });
                done();
            });
        });
    });

    describe('GET /builds/{id}', () => {
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';

        it('returns 200 for a build that exists', (done) => {
            buildMock.get.withArgs(id).yieldsAsync(null, testBuild);
            server.inject(`/builds/${id}`, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, testBuild);
                done();
            });
        });

        it('returns 404 when build does not exist', (done) => {
            buildMock.get.withArgs(id).yieldsAsync(null, null);
            server.inject(`/builds/${id}`, (reply) => {
                assert.equal(reply.statusCode, 404);
                done();
            });
        });

        it('returns 500 when datastore returns an error', (done) => {
            buildMock.get.withArgs(id).yieldsAsync(new Error('blah'));
            server.inject(`/builds/${id}`, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('PUT /builds/{id}', () => {
        const id = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const config = {
            id,
            data: {
                status: 'SUCCESS'
            }
        };

        it('returns 200 for updating a build that exists', (done) => {
            buildMock.update.withArgs(config).yieldsAsync(null, {
                id,
                status: 'SUCCESS'
            });
            const options = {
                method: 'PUT',
                url: `/builds/${id}`,
                payload: {
                    status: 'SUCCESS'
                },
                credentials: {
                    scope: ['user']
                }
            };

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 200);
                assert.deepEqual(reply.result, {
                    id,
                    status: 'SUCCESS'
                });
                done();
            });
        });

        it('returns 404 for updating a build that does not exist', (done) => {
            buildMock.update.withArgs(config).yieldsAsync(null, null);
            const options = {
                method: 'PUT',
                url: `/builds/${id}`,
                payload: {
                    status: 'SUCCESS'
                },
                credentials: {
                    scope: ['user']
                }
            };

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 404);
                done();
            });
        });

        it('returns 500 when the datastore returns an error', (done) => {
            buildMock.update.withArgs(config).yieldsAsync(new Error('error'));
            const options = {
                method: 'PUT',
                url: `/builds/${id}`,
                payload: {
                    status: 'SUCCESS'
                },
                credentials: {
                    scope: ['user']
                }
            };

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });
    });

    describe('POST /builds', () => {
        const username = 'myself';
        const buildId = 'd398fb192747c9a0124e9e5b4e6e8e841cf8c71c';
        const jobId = '62089f642bbfd1886623964b4cff12db59869e5d';
        const pipelineId = '2d991790bab1ac8576097ca87f170df73410b55c';
        const scmUrl = 'git@github.com:screwdriver-cd/data-model.git#master';
        const params = {
            jobId: '62089f642bbfd1886623964b4cff12db59869e5d',
            apiUri: 'http://localhost:12345',
            tokenGen: sinon.match.func,
            username
        };

        let options;

        beforeEach(() => {
            options = {
                method: 'POST',
                url: '/builds',
                payload: {
                    jobId
                },
                credentials: {
                    scope: ['user'],
                    username
                },
                password: 'thiadchlsifhesfr'
            };
        });

        it('returns 201 for a successful create', (done) => {
            let expectedLocation;

            jobMock.get.withArgs(jobId).yieldsAsync(null, { pipelineId });
            pipelineMock.get.withArgs(pipelineId).yieldsAsync(null, { scmUrl });
            userMock.getPermissions.withArgs({ username, scmUrl })
                .yieldsAsync(null, { push: true });
            buildMock.create.withArgs(params)
                .yieldsAsync(null, { id: buildId, other: 'dataToBeIncluded' });

            server.inject(options, (reply) => {
                expectedLocation = {
                    host: reply.request.headers.host,
                    port: reply.request.headers.port,
                    protocol: reply.request.server.info.protocol,
                    pathname: `${options.url}/${buildId}`
                };
                assert.equal(reply.statusCode, 201);
                assert.deepEqual(reply.result, {
                    id: buildId,
                    other: 'dataToBeIncluded'
                });
                assert.strictEqual(reply.headers.location, urlLib.format(expectedLocation));
                assert.calledWith(buildMock.create, params);
                assert.equal(buildMock.create.getCall(0).args[0].tokenGen('12345'),
                    '{"username":"12345","scope":["build"]}"1234secretkeythatissupersecret5678"');
                done();
            });
        });

        it('returns 500 when the model encounters an error', (done) => {
            const testError = new Error('datastoreSaveError');

            jobMock.get.withArgs(jobId).yieldsAsync(null, { pipelineId });
            pipelineMock.get.withArgs(pipelineId).yieldsAsync(null, { scmUrl });
            userMock.getPermissions.withArgs({ username, scmUrl })
                .yieldsAsync(null, { push: true });
            buildMock.create.withArgs(params).yieldsAsync(testError);

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 500);
                done();
            });
        });

        it('returns unauthorized error when user does not have push permission', (done) => {
            jobMock.get.withArgs(jobId).yieldsAsync(null, { pipelineId });
            pipelineMock.get.withArgs(pipelineId).yieldsAsync(null, { scmUrl });
            userMock.getPermissions.withArgs({ username, scmUrl })
                .yieldsAsync(null, { push: false });

            server.inject(options, (reply) => {
                assert.equal(reply.statusCode, 401);
                done();
            });
        });
    });
});