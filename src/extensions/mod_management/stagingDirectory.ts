import Promise from 'bluebird';
import { app as appIn, remote } from 'electron';
import * as path from 'path';
import { generate as shortid } from 'shortid';
import { IDialogResult } from '../../types/IDialog';
import { IExtensionApi } from '../../types/IExtensionContext';
import { IState } from '../../types/IState';
import { ProcessCanceled, UserCanceled } from '../../util/CustomErrors';
import * as fs from '../../util/fs';
import { log } from '../../util/log';
import { activeGameId, installPathForGame } from '../../util/selectors';
import { getSafe } from '../../util/storeHelper';
import { truthy } from '../../util/util';
import { setInstallPath } from './actions/settings';
import { fallbackPurge } from './util/activationStore';

const app = remote !== undefined ? remote.app : appIn;

export const STAGING_DIR_TAG = '__vortex_staging_folder';

function writeStagingTag(api: IExtensionApi, tagPath: string, gameId: string) {
  const state: IState = api.store.getState();
  const data = {
    instance: state.app.instanceId,
    game: gameId,
  };
  return fs.writeFileAsync(tagPath, JSON.stringify(data), {  encoding: 'utf8' });
}

function validateStagingTag(api: IExtensionApi, tagPath: string): Promise<void> {
  return fs.readFileAsync(tagPath, { encoding: 'utf8' })
    .then(data => {
      const state: IState = api.store.getState();
      const tag = JSON.parse(data);
      if (tag.instance !== state.app.instanceId) {
        return api.showDialog('question', 'Confirm', {
          text: 'This is a staging folder but it appears to belong to a different Vortex '
              + 'instance. If you\'re using Vortex in shared and "regular" mode, do not use '
              + 'the same staging folder for both!',
        }, [
          { label: 'Cancel' },
          { label: 'Continue' },
        ])
        .then(result => (result.action === 'Cancel')
          ? Promise.reject(new UserCanceled())
          : Promise.resolve());
      }
      return Promise.resolve();
    })
    .catch(err => {
      if (err instanceof UserCanceled) {
        return Promise.reject(err);
      }
      return api.showDialog('question', 'Confirm', {
        text: 'This directory is not marked as a staging folder. '
            + 'Are you *sure* it\'s the right directory?',
      }, [
        { label: 'Cancel' },
        { label: 'I\'m sure' },
      ])
      .then(result => result.action === 'Cancel'
        ? Promise.reject(new UserCanceled())
        : Promise.resolve());
    });
}

function queryStagingFolderInvalid(api: IExtensionApi,
                                   err: Error,
                                   dirExists: boolean,
                                   instPath: string)
                                   : Promise<IDialogResult> {
  if (dirExists) {
    // dir exists but not tagged
    return api.showDialog('error', 'Mod Staging Folder invalid', {
      bbcode: 'Your mod staging folder "{{path}}" is not marked correctly. This may be ok '
          + 'if you\'ve updated from a very old version of Vortex and you can ignore this.<br/>'
          + '[b]However[/b], if you use a removable medium (network or USB drive) and that path '
          + 'does not actually point to your real staging folder, you [b]have[/b] '
          + 'to make sure the actual folder is available and tell Vortex where it is.',
      message: err.message,
      parameters: {
        path: instPath,
      },
    }, [
      { label: 'Quit Vortex' },
      { label: 'Ignore' },
      { label: 'Browse...' },
    ]);
  }
  return api.showDialog('error', 'Mod Staging Folder missing!', {
      text: 'Your mod staging folder "{{path}}" is missing. This might happen because you '
        + 'deleted it or - if you have it on a removable drive - it is not currently '
        + 'connected.\nIf you continue now, a new staging folder will be created but all '
        + 'your previously managed mods will be lost.\n\n'
        + 'If you have moved the folder or the drive letter changed, you can browse '
        + 'for the new location manually, but please be extra careful to select the right '
        + 'folder!',
      message: instPath,
      parameters: {
        path: instPath,
      },
    }, [
      { label: 'Quit Vortex' },
      { label: 'Reinitialize' },
      { label: 'Browse...' },
    ]);
}

export function ensureStagingDirectory(api: IExtensionApi,
                                       instPath?: string,
                                       gameId?: string)
                                       : Promise<string> {
  const state = api.store.getState();
  if (gameId === undefined) {
    gameId = activeGameId(state);
  }
  if (instPath === undefined) {
    instPath = installPathForGame(state, gameId);
  }

  let dirExists = false;
  return fs.statAsync(instPath)
    .then(() => {
      dirExists = true;
      // staging dir exists, does the tag exist?
      return fs.statAsync(path.join(instPath, STAGING_DIR_TAG));
    })
    .catch(err => {
      const mods = getSafe(state, ['persistent', 'mods', gameId], undefined);
      if ((dirExists === false) && (mods === undefined)) {
        // If the mods state branch for this game is undefined - this must be the
        //  first time we manage this game - just create the staging path.
        //
        // This code should never be hit because the directory is created in
        // profile_management/index.ts as soon as we start managing the game for the
        // first time but we probably still don't want to report an error if we have
        // no meta information about any mods anyway
        return fs.ensureDirWritableAsync(instPath, () => Promise.resolve());
      }
      return queryStagingFolderInvalid(api, err, dirExists, instPath)
        .then(dialogResult => {
          if (dialogResult.action === 'Quit Vortex') {
            app.exit(0);
            return Promise.reject(new UserCanceled());
          } else if (dialogResult.action === 'Reinitialize') {
            const id = shortid();
            api.sendNotification({
              id,
              type: 'activity',
              message: 'Purging mods',
            });
            return fallbackPurge(api)
              .then(() => fs.ensureDirWritableAsync(instPath, () => Promise.resolve()))
              .catch(purgeErr => {
                if (purgeErr instanceof ProcessCanceled) {
                  log('warn', 'Mods not purged', purgeErr.message);
                } else {
                  api.showDialog('error', 'Mod Staging Folder missing!', {
                    bbcode: 'The staging folder could not be created. '
                      + 'You [b][color=red]have[/color][/b] to go to settings->mods and change it '
                      + 'to a valid directory [b][color=red]before doing anything else[/color][/b] '
                      + 'or you will get further error messages.',
                  }, [
                    { label: 'Close' },
                  ]);
                }
                return Promise.reject(new ProcessCanceled('not purged'));
              })
              .finally(() => {
                api.dismissNotification(id);
              });
          } else if (dialogResult.action === 'Ignore') {
            return Promise.resolve();
          } else { // Browse...
            return api.selectDir({
              defaultPath: instPath,
              title: api.translate('Select staging folder'),
            })
              .then((selectedPath) => {
                if (!truthy(selectedPath)) {
                  return Promise.reject(new UserCanceled());
                }
                return validateStagingTag(api, path.join(selectedPath, STAGING_DIR_TAG))
                  .then(() => {
                    instPath = selectedPath;
                    api.store.dispatch(setInstallPath(gameId, instPath));
                  });
              })
              .catch(() => ensureStagingDirectory(api, instPath, gameId));
          }
        });
      })
    .then(() => writeStagingTag(api, path.join(instPath, STAGING_DIR_TAG), gameId))
    .then(() => instPath);
}
