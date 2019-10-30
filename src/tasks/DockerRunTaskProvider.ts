/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.md in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Task } from 'vscode';
import { DockerPlatform } from '../debugging/DockerPlatformHelper';
import { cloneObject } from '../utils/cloneObject';
import { CommandLineBuilder } from '../utils/commandLineBuilder';
import { DockerRunOptions } from './DockerRunTaskDefinitionBase';
import { DockerTaskProvider } from './DockerTaskProvider';
import { NetCoreRunTaskDefinition } from './netcore/NetCoreTaskHelper';
import { NodeRunTaskDefinition } from './node/NodeTaskHelper';
import { DockerRunTaskContext, getAssociatedDockerBuildTask, TaskHelper, throwIfCancellationRequested } from './TaskHelper';

export interface DockerRunTaskDefinition extends NetCoreRunTaskDefinition, NodeRunTaskDefinition {
    label?: string;
    dependsOn?: string[];
    platform?: DockerPlatform;
}

export interface DockerRunTask extends Task {
    definition: DockerRunTaskDefinition;
}

export class DockerRunTaskProvider extends DockerTaskProvider {
    constructor(helpers: { [key in DockerPlatform]: TaskHelper }) { super('docker-run', helpers) }

    // TODO: Skip if container is freshly started, but probably depends on language
    protected async executeTaskInternal(context: DockerRunTaskContext, task: DockerRunTask): Promise<void> {
        const definition = cloneObject(task.definition);
        definition.dockerRun = definition.dockerRun || {};

        context.actionContext.telemetry.properties.containerOS = definition.dockerRun.os || 'Linux';

        context.buildDefinition = await getAssociatedDockerBuildTask(task);

        const helper = this.getHelper(context.platform);

        if (helper && helper.preRun) {
            await helper.preRun(context, definition);
            throwIfCancellationRequested(context);
        }

        if (helper) {
            definition.dockerRun = await helper.getDockerRunOptions(context, definition);
            throwIfCancellationRequested(context);
        }

        await this.validateResolvedDefinition(context, definition.dockerRun);

        const commandLine = await this.resolveCommandLine(definition.dockerRun);

        const { stdout } = await context.terminal.executeCommandInTerminal(commandLine, context.folder, /* rejectOnStdError: */ true, context.cancellationToken);
        throwIfCancellationRequested(context);

        context.containerId = stdout;

        if (helper && helper.preRun) {
            await helper.preRun(context, definition);
        }
    }

    private async validateResolvedDefinition(context: DockerRunTaskContext, dockerRun: DockerRunOptions): Promise<void> {
        if (!dockerRun.image) {
            throw new Error('No Docker image name was provided or resolved.');
        }
    }

    private async resolveCommandLine(runOptions: DockerRunOptions): Promise<CommandLineBuilder> {
        return CommandLineBuilder
            .create('docker', 'run', '-dt')
            .withFlagArg('-P', runOptions.portsPublishAll || (runOptions.portsPublishAll === undefined && (runOptions.ports === undefined || runOptions.ports.length < 1)))
            .withNamedArg('--name', runOptions.containerName)
            .withNamedArg('--network', runOptions.network)
            .withNamedArg('--network-alias', runOptions.networkAlias)
            .withKeyValueArgs('-e', runOptions.env)
            .withArrayArgs('--env-file', runOptions.envFiles)
            .withKeyValueArgs('--label', runOptions.labels)
            .withArrayArgs('-v', runOptions.volumes, volume => `${volume.localPath}:${volume.containerPath}${volume.permissions ? ':' + volume.permissions : ''}`)
            .withArrayArgs('-p', runOptions.ports, port => `${port.hostPort ? port.hostPort + ':' : ''}${port.containerPort}${port.protocol ? '/' + port.protocol : ''}`)
            .withArrayArgs('--add-host', runOptions.extraHosts, extraHost => `${extraHost.hostname}:${extraHost.ip}`)
            .withNamedArg('--entrypoint', runOptions.entrypoint)
            .withQuotedArg(runOptions.image)
            .withArgs(runOptions.command);
    }
}