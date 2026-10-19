"""track artist

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-19 12:40:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = '0002'
down_revision = '0001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('tracks', schema=None) as batch_op:
        batch_op.add_column(sa.Column('artist', sa.String(length=300), nullable=False, server_default=''))

    # Раньше исполнитель хранился в названии: «Исполнитель — Название».
    tracks = sa.table('tracks', sa.column('id', sa.Integer), sa.column('title', sa.String), sa.column('artist', sa.String))
    conn = op.get_bind()
    for tid, title in conn.execute(sa.select(tracks.c.id, tracks.c.title)).all():
        artist, sep, rest = title.partition(' — ')
        if sep and artist.strip() and rest.strip():
            conn.execute(tracks.update().where(tracks.c.id == tid).values(artist=artist.strip(), title=rest.strip()))


def downgrade() -> None:
    tracks = sa.table('tracks', sa.column('title', sa.String), sa.column('artist', sa.String))
    op.get_bind().execute(
        tracks.update().where(tracks.c.artist != '').values(title=tracks.c.artist + ' — ' + tracks.c.title)
    )
    with op.batch_alter_table('tracks', schema=None) as batch_op:
        batch_op.drop_column('artist')
