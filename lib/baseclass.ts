import Homey from 'homey';
import type Picnic from '../app';

// The Homey these helpers are handed, whose app is this one rather than any.
export type PicnicHomey = Homey.App['homey'] & { app: Picnic };

export default class BaseClass extends Homey.SimpleClass {
    declare homey: PicnicHomey;

    constructor(...props: ConstructorParameters<typeof Homey.SimpleClass>) {
        super(...props);
    }
}
