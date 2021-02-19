/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = (pgm) => {
    pgm.createTable('labels', {
        id: 'id',
        label: { type: 'varchar(255)', notNull: true, unique: true }
    })
};

exports.down = (pgm) => {
    pgm.dropTable('labels')
};