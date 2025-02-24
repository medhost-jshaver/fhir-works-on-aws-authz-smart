/*
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *  SPDX-License-Identifier: Apache-2.0
 */
import { BulkDataAuth } from 'fhir-works-on-aws-interface';
import { ScopeRule, ScopeType } from './smartConfig';
import {
    isScopeSufficient,
    convertScopeToSmartScope,
    filterOutUnusableScope,
    getScopes,
    getValidOperationsForScopeTypeAndAccessType,
} from './smartScopeHelper';

const emptyScopeRule = (): ScopeRule => ({
    patient: {
        read: [],
        write: [],
    },
    user: {
        read: [],
        write: [],
    },
    system: {
        read: [],
        write: [],
    },
});
const isScopeSufficientCases: ScopeType[][] = [['user'], ['patient'], ['system']];
describe.each(isScopeSufficientCases)('%s: isScopeSufficient', (scopeType: ScopeType) => {
    test('scope is sufficient to read Observation: Scope with resourceType "Observation" should be able to read "Observation" resources', () => {
        const clonedScopeRule = emptyScopeRule();
        clonedScopeRule[scopeType].read = ['read'];

        expect(isScopeSufficient(`${scopeType}/Observation.read`, clonedScopeRule, 'read', 'Observation')).toEqual(
            true,
        );
    });

    test('scope is sufficient to read Observation: Scope with resourceType "*" should be able to read "Observation" resources', () => {
        const clonedScopeRule = emptyScopeRule();
        clonedScopeRule[scopeType].read = ['read'];

        expect(isScopeSufficient(`${scopeType}/*.read`, clonedScopeRule, 'read', 'Observation')).toEqual(true);
    });

    test('scope is NOT sufficient to read Observation because scopeRule does not allow read operation', () => {
        const clonedScopeRule = emptyScopeRule();
        clonedScopeRule[scopeType].read = ['search-type'];

        expect(isScopeSufficient(`${scopeType}/Medication.read`, clonedScopeRule, 'read', 'Observation')).toEqual(
            false,
        );
    });

    test('scope is NOT sufficient to read Observation because resourceType does not match', () => {
        const clonedScopeRule = emptyScopeRule();
        clonedScopeRule[scopeType].read = ['read'];

        expect(isScopeSufficient(`${scopeType}/Medication.read`, clonedScopeRule, 'read', 'Observation')).toEqual(
            false,
        );
    });

    test('scope is sufficient for bulk data access with "user" || "system" scopeType but not "patient" scopeType', () => {
        const clonedScopeRule = emptyScopeRule();
        clonedScopeRule[scopeType].read = ['read'];
        const bulkDataAuth: BulkDataAuth = { operation: 'initiate-export', exportType: 'system' };

        // Only scopeType of user has bulkDataAccess
        expect(isScopeSufficient(`${scopeType}/*.read`, clonedScopeRule, 'read', undefined, bulkDataAuth)).toEqual(
            scopeType !== 'patient',
        );
    });

    test('scope is NOT sufficient for bulk data access: Scope needs to have resourceType "*"', () => {
        const clonedScopeRule = emptyScopeRule();
        clonedScopeRule[scopeType].read = ['read'];

        const bulkDataAuth: BulkDataAuth = { operation: 'initiate-export', exportType: 'system' };
        expect(
            isScopeSufficient(`${scopeType}/Observation.read`, clonedScopeRule, 'read', undefined, bulkDataAuth),
        ).toEqual(false);
    });
    test('scope is sufficient to do a search-system', () => {
        const clonedScopeRule = emptyScopeRule();
        clonedScopeRule[scopeType].read = ['search-system'];

        expect(isScopeSufficient(`${scopeType}/*.read`, clonedScopeRule, 'search-system')).toEqual(true);
    });
    test('scope is sufficient to do a transaction', () => {
        const clonedScopeRule = emptyScopeRule();
        clonedScopeRule[scopeType].write = ['transaction'];

        expect(isScopeSufficient(`${scopeType}/*.write`, clonedScopeRule, 'transaction')).toEqual(true);
    });
    test('scope is insufficient to do a transaction', () => {
        const clonedScopeRule = emptyScopeRule();
        clonedScopeRule[scopeType].read = ['read'];
        clonedScopeRule[scopeType].write = ['create'];

        expect(isScopeSufficient(`${scopeType}/*.*`, clonedScopeRule, 'transaction')).toEqual(false);
    });
    test('invalid scope', () => {
        const clonedScopeRule = emptyScopeRule();
        clonedScopeRule[scopeType].read = ['read'];

        expect(isScopeSufficient(`fake`, clonedScopeRule, 'read')).toEqual(false);
    });
});

describe('getScopes', () => {
    test('scope type delimited by space', () => {
        expect(getScopes('launch/encounter user/*.read fake system/*.*')).toEqual([
            'launch/encounter',
            'user/*.read',
            'fake',
            'system/*.*',
        ]);
    });
    test('scope type as array', () => {
        expect(getScopes(['launch/encounter', 'user/*.read', 'fake', 'system/*.*'])).toEqual([
            'launch/encounter',
            'user/*.read',
            'fake',
            'system/*.*',
        ]);
    });
});
describe('filterOutUnusableScope', () => {
    test('no filter occuring', () => {
        const clonedScopeRule = emptyScopeRule();
        clonedScopeRule.user.read = ['read'];
        clonedScopeRule.patient.read = ['read'];
        const expectedScopes = ['user/*.read', 'patient/*.*'];
        expect(
            filterOutUnusableScope(
                expectedScopes,
                clonedScopeRule,
                'read',
                'Patient',
                undefined,
                'launchPatient',
                'fhirUser',
            ),
        ).toEqual(expectedScopes);
    });
    test('filter user; due to no fhirUser', () => {
        const clonedScopeRule = emptyScopeRule();
        clonedScopeRule.user.read = ['read'];
        clonedScopeRule.patient.read = ['read'];
        const scopes = ['user/*.read', 'user/Patient.read', 'patient/*.*'];
        expect(
            filterOutUnusableScope(scopes, clonedScopeRule, 'read', 'Patient', undefined, 'launchPatient', undefined),
        ).toEqual(['patient/*.*']);
    });
    test('filter user; due to scope being insufficient', () => {
        const clonedScopeRule = emptyScopeRule();
        clonedScopeRule.user.read = ['read'];
        clonedScopeRule.patient.read = ['read'];
        const scopes = ['user/*.write', 'user/Patient.read', 'patient/*.*'];
        expect(
            filterOutUnusableScope(scopes, clonedScopeRule, 'read', 'Patient', undefined, 'launchPatient', 'fhirUser'),
        ).toEqual(['user/Patient.read', 'patient/*.*']);
    });
    test('filter patient; due to no launch context', () => {
        const clonedScopeRule = emptyScopeRule();
        clonedScopeRule.user.read = ['read'];
        clonedScopeRule.patient.read = ['read'];
        const scopes = ['user/*.read', 'user/Patient.read', 'patient/*.*'];
        expect(
            filterOutUnusableScope(scopes, clonedScopeRule, 'read', 'Patient', undefined, undefined, 'fhirUser'),
        ).toEqual(['user/*.read', 'user/Patient.read']);
    });
    test('filter patient; due to scope being insufficient', () => {
        const clonedScopeRule = emptyScopeRule();
        clonedScopeRule.user.read = ['read'];
        clonedScopeRule.patient.read = ['read'];
        const scopes = ['user/Patient.read', 'patient/Obersvation.*', 'patient/*.read'];
        expect(
            filterOutUnusableScope(scopes, clonedScopeRule, 'read', 'Patient', undefined, 'launchPatient', 'fhirUser'),
        ).toEqual(['user/Patient.read', 'patient/*.read']);
    });

    test('filter system; due to scope being insufficient', () => {
        const clonedScopeRule = emptyScopeRule();
        clonedScopeRule.user.read = ['read'];
        clonedScopeRule.patient.read = ['read'];
        clonedScopeRule.system.read = ['read'];
        const scopes = ['user/Patient.read', 'system/Obersvation.*', 'system/*.read'];
        expect(
            filterOutUnusableScope(scopes, clonedScopeRule, 'read', 'Patient', undefined, undefined, 'fhirUser'),
        ).toEqual(['user/Patient.read', 'system/*.read']);
    });

    test('filter user & patient', () => {
        const clonedScopeRule = emptyScopeRule();
        clonedScopeRule.user.read = ['read'];
        clonedScopeRule.patient.read = ['read'];
        expect(
            filterOutUnusableScope(
                ['launch', 'fhirUser', 'user/Patient.read', 'patient/Obersvation.*', 'patient/*.read'],
                clonedScopeRule,
                'read',
                'Patient',
            ),
        ).toEqual([]);
    });

    test('filter user & patient; transaction use case', () => {
        const clonedScopeRule = emptyScopeRule();
        clonedScopeRule.user.read = ['read'];
        clonedScopeRule.patient.read = ['read'];
        clonedScopeRule.system.write = ['transaction'];
        expect(
            filterOutUnusableScope(
                ['fhirUser', 'user/Patient.read', 'patient/Obersvation.*', 'patient/*.read', 'system/*.write'],
                clonedScopeRule,
                'transaction',
            ),
        ).toEqual(['system/*.write']);
    });
});

describe('getValidOperationsForScopeTypeAndAccessType', () => {
    const clonedScopeRule = emptyScopeRule();
    clonedScopeRule.user = {
        read: ['read'],
        write: ['create'],
    };
    test('read scope', () => {
        const validOperations = getValidOperationsForScopeTypeAndAccessType('user', 'read', clonedScopeRule);
        expect(validOperations).toEqual(['read']);
    });

    test('write scope', () => {
        const validOperations = getValidOperationsForScopeTypeAndAccessType('user', 'write', clonedScopeRule);
        expect(validOperations).toEqual(['create']);
    });

    test('* scope', () => {
        const validOperations = getValidOperationsForScopeTypeAndAccessType('user', '*', clonedScopeRule);
        expect(validOperations).toEqual(['read', 'create']);
    });
});

describe('convertScopeToSmartScope', () => {
    test('launchScope', () => {
        const scope = 'launch/encounter';
        expect(() => {
            convertScopeToSmartScope(scope);
        }).toThrowError(new Error('Not a SmartScope'));
    });
    test('user clinicalScope', () => {
        const scope = 'user/Observation.read';
        expect(convertScopeToSmartScope(scope)).toEqual({
            accessType: 'read',
            resourceType: 'Observation',
            scopeType: 'user',
        });
    });
    test('patient clinicalScope', () => {
        const scope = 'patient/Fake.*';
        expect(convertScopeToSmartScope(scope)).toEqual({
            accessType: '*',
            resourceType: 'Fake',
            scopeType: 'patient',
        });
    });
});
